import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import {
  api,
  base64url,
  cookiePair,
  login,
  PASSWORD,
  projectIdByName,
  refreshSetCookie,
  startTestServer,
  taskIdByTitle,
  type Session,
} from './helpers.js';

let stopServer: () => Promise<void>;

before(async () => {
  stopServer = await startTestServer();
});

after(async () => {
  await stopServer();
});

describe('authentication', () => {
  test('login returns the access token in JSON and the refresh token only as a hardened cookie', async () => {
    const res = await api('POST', '/api/auth/login', { body: { email: ' Admin@Example.com', password: PASSWORD } });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.accessToken, 'string');
    assert.equal(res.body.user.role, 'ADMIN');
    assert.equal(res.headers.get('cache-control'), 'no-store');

    const cookie = refreshSetCookie(res) ?? '';
    assert.match(cookie, /^refresh_token=[\w-]{43};/);
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/auth']) {
      assert.ok(cookie.split('; ').includes(attribute), `cookie is missing ${attribute}: ${cookie}`);
    }
    const refreshToken = cookiePair(cookie).split('=')[1] ?? '';
    assert.ok(!JSON.stringify(res.body).includes(refreshToken), 'refresh token leaked into the JSON body');
    assert.ok(!('refreshToken' in res.body));
  });

  test('wrong password and unknown email get the same generic 401 and no cookie', async () => {
    const wrongPassword = await api('POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'nope' } });
    const unknownEmail = await api('POST', '/api/auth/login', { body: { email: 'ghost@example.com', password: 'nope' } });
    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(wrongPassword.body, unknownEmail.body);
    assert.equal(wrongPassword.headers.getSetCookie().length, 0);
  });

  test('refresh rotates the token; replaying a used one revokes the whole session', async () => {
    const session = await login('priya.sharma@example.com');
    const rotated = await api('POST', '/api/auth/refresh', { cookie: session.cookie });
    assert.equal(rotated.status, 200);
    assert.equal(typeof rotated.body.accessToken, 'string');
    const newCookie = cookiePair(refreshSetCookie(rotated));
    assert.ok(newCookie && newCookie !== session.cookie, 'expected a new refresh token');

    assert.equal((await api('POST', '/api/auth/refresh', { cookie: session.cookie })).status, 401);
    // Reuse means the old token leaked, so the legitimately rotated token is revoked as well.
    assert.equal((await api('POST', '/api/auth/refresh', { cookie: newCookie })).status, 401);
  });

  test('logout revokes the refresh token and clears the cookie', async () => {
    const session = await login('marcus.chen@example.com');
    const res = await api('POST', '/api/auth/logout', { cookie: session.cookie });
    assert.equal(res.status, 204);
    assert.match(refreshSetCookie(res) ?? '', /^refresh_token=;.*Expires=Thu, 01 Jan 1970/);
    assert.equal((await api('POST', '/api/auth/refresh', { cookie: session.cookie })).status, 401);
  });

  test('rejects missing, forged, alg=none and expired access tokens', async () => {
    const sofia = await login('sofia.alvarez@example.com');
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
    const [header, , signature] = sofia.token.split('.');
    const claims = { sub: admin.id, iss: 'pm-dashboard-api', aud: 'pm-dashboard', exp: Math.floor(Date.now() / 1000) + 600 };

    const badTokens: Record<string, string | undefined> = {
      missing: undefined,
      'payload swapped to the admin': `${header}.${base64url(claims)}.${signature}`,
      'signed with another secret': jwt.sign(claims, 'x'.repeat(48)),
      'alg=none': `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(claims)}.`,
    };
    for (const [name, token] of Object.entries(badTokens)) {
      assert.equal((await api('GET', '/api/tasks', { token })).status, 401, name);
    }

    const expired = jwt.sign({ ...claims, sub: sofia.userId, exp: Math.floor(Date.now() / 1000) - 10 }, env.JWT_ACCESS_SECRET);
    const res = await api('GET', '/api/tasks', { token: expired });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'TOKEN_EXPIRED');
    assert.equal((await api('GET', '/api/tasks', { token: sofia.token })).status, 200);
  });

  test('a deactivated user is locked out immediately, even with an unexpired token', async () => {
    const emma = await login('emma.larsen@example.com');
    await prisma.user.update({ where: { id: emma.userId }, data: { isActive: false } });
    try {
      assert.equal((await api('GET', '/api/tasks', { token: emma.token })).status, 401);
      assert.equal((await api('POST', '/api/auth/refresh', { cookie: emma.cookie })).status, 401);
    } finally {
      await prisma.user.update({ where: { id: emma.userId }, data: { isActive: true } });
    }
  });
});

describe('RBAC', () => {
  let admin: Session, priya: Session, marcus: Session, daniel: Session, kenji: Session;

  before(async () => {
    [admin, priya, marcus, daniel, kenji] = await Promise.all([
      login('admin@example.com'),
      login('priya.sharma@example.com'),
      login('marcus.chen@example.com'),
      login('daniel.okafor@example.com'),
      login('kenji.tanaka@example.com'),
    ]);
  });

  test('requireRole: developers cannot reach project routes at all', async () => {
    const res = await api('GET', '/api/projects', { token: daniel.token });
    assert.equal(res.status, 403);
    const portal = await projectIdByName('Customer Portal Redesign');
    assert.equal((await api('POST', `/api/projects/${portal}/tasks`, { token: daniel.token, body: { title: 'x' } })).status, 403);
  });

  test('project lists are scoped: admin sees all, a PM only their own', async () => {
    const names = async (token: string) =>
      (await api('GET', '/api/projects', { token })).body.data.map((p: { name: string }) => p.name).sort();
    assert.equal((await names(admin.token)).length, 3);
    assert.deepEqual(await names(marcus.token), ['Mobile App v2.0']);
    assert.deepEqual(await names(priya.token), ['Customer Portal Redesign', 'Payments Service Migration']);
  });

  test('task lists are scoped, and filters can never widen the scope', async () => {
    const mine = await api('GET', '/api/tasks', { token: daniel.token });
    assert.ok(mine.body.data.length > 0);
    assert.ok(mine.body.data.every((t: { assigneeId: string }) => t.assigneeId === daniel.userId));

    const mobile = await projectIdByName('Mobile App v2.0'); // Daniel has no tasks there
    const otherProject = await api('GET', `/api/tasks?projectId=${mobile}`, { token: daniel.token });
    assert.deepEqual(otherProject.body.data, []);
    // A developer's list is always their own, so an assignee filter is a validation error, not a way in.
    const assigneeFilter = await api('GET', `/api/tasks?assigneeId=${kenji.userId}`, { token: daniel.token });
    assert.equal(assigneeFilter.status, 400);

    const pmTasks = await api('GET', '/api/tasks', { token: marcus.token });
    assert.ok(pmTasks.body.data.every((t: { project: { ownerId: string } }) => t.project.ownerId === marcus.userId));
  });

  test("a PM cannot read, modify, delete or add tasks to another PM's project", async () => {
    const portal = await projectIdByName('Customer Portal Redesign'); // owned by Priya
    const priyasTask = await taskIdByTitle('Server-side pagination for invoices view');
    const attempts: [string, string, unknown?][] = [
      ['GET', `/api/projects/${portal}`],
      ['PATCH', `/api/projects/${portal}`, { name: 'Hijacked' }],
      ['DELETE', `/api/projects/${portal}`],
      ['POST', `/api/projects/${portal}/tasks`, { title: 'Sneaky task' }],
      ['GET', `/api/tasks/${priyasTask}`],
      ['PATCH', `/api/tasks/${priyasTask}`, { priority: 'LOW' }],
      ['DELETE', `/api/tasks/${priyasTask}`],
    ];
    for (const [method, path, body] of attempts) {
      assert.equal((await api(method, path, { token: marcus.token, body })).status, 403, `${method} ${path}`);
    }
    const project = await prisma.project.findUniqueOrThrow({ where: { id: portal }, include: { _count: { select: { tasks: true } } } });
    assert.equal(project.name, 'Customer Portal Redesign');
    assert.equal(project._count.tasks, 6);
  });

  test("a developer cannot read, modify or delete another developer's task, even with a valid token", async () => {
    const kenjisTask = await taskIdByTitle('Deep linking for shared content');
    assert.equal((await api('GET', `/api/tasks/${kenjisTask}`, { token: daniel.token })).status, 403);
    assert.equal((await api('PATCH', `/api/tasks/${kenjisTask}`, { token: daniel.token, body: { status: 'IN_PROGRESS' } })).status, 403);
    assert.equal((await api('DELETE', `/api/tasks/${kenjisTask}`, { token: daniel.token })).status, 403);
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: kenjisTask } })).status, 'TODO');
  });

  test('a developer can move their own task forward, but change nothing else', async () => {
    const own = await taskIdByTitle('Server-side pagination for invoices view'); // Daniel, IN_PROGRESS
    const moved = await api('PATCH', `/api/tasks/${own}`, { token: daniel.token, body: { status: 'IN_REVIEW' } });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.status, 'IN_REVIEW');
    const entry = await prisma.activityLog.findFirstOrThrow({ where: { taskId: own }, orderBy: { createdAt: 'desc' } });
    assert.equal(entry.actorId, daniel.userId);
    assert.deepEqual(entry.metadata, { from: 'IN_PROGRESS', to: 'IN_REVIEW' });

    const forbiddenBodies = [
      { title: 'Renamed' },
      { assigneeId: kenji.userId },
      { status: 'IN_PROGRESS', dueDate: '2030-01-01T00:00:00Z' },
      { status: 'DONE' },
      { status: 'OVERDUE' },
    ];
    for (const body of forbiddenBodies) {
      assert.equal((await api('PATCH', `/api/tasks/${own}`, { token: daniel.token, body })).status, 403, JSON.stringify(body));
    }
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: own } })).title, 'Server-side pagination for invoices view');
  });

  test('assignees must be developers; DONE stamps completedAt; OVERDUE is system-only', async () => {
    const task = await taskIdByTitle('Load test checkout at 3x peak traffic'); // Priya's project
    assert.equal((await api('PATCH', `/api/tasks/${task}`, { token: priya.token, body: { assigneeId: marcus.userId } })).status, 422);

    const reassigned = await api('PATCH', `/api/tasks/${task}`, { token: priya.token, body: { assigneeId: daniel.userId } });
    assert.equal(reassigned.status, 200);
    assert.equal(reassigned.body.assignee.id, daniel.userId);

    const done = await api('PATCH', `/api/tasks/${task}`, { token: priya.token, body: { status: 'DONE' } });
    assert.equal(done.status, 200);
    assert.ok(done.body.completedAt);

    assert.equal((await api('PATCH', `/api/tasks/${task}`, { token: admin.token, body: { status: 'OVERDUE' } })).status, 400);
  });

  test('only admins transfer ownership, and owners must be project managers', async () => {
    const portal = await projectIdByName('Customer Portal Redesign');
    assert.equal((await api('PATCH', `/api/projects/${portal}`, { token: priya.token, body: { ownerId: marcus.userId } })).status, 403);
    assert.equal((await api('POST', '/api/projects', { token: priya.token, body: { name: 'X', ownerId: marcus.userId } })).status, 403);
    assert.equal((await api('POST', '/api/projects', { token: admin.token, body: { name: 'X' } })).status, 422);
    assert.equal((await api('POST', '/api/projects', { token: admin.token, body: { name: 'X', ownerId: daniel.userId } })).status, 422);

    const created = await api('POST', '/api/projects', { token: admin.token, body: { name: 'Internal Tools', ownerId: marcus.userId } });
    assert.equal(created.status, 201);
    assert.equal(created.body.ownerId, marcus.userId);

    const task = await api('POST', `/api/projects/${created.body.id}/tasks`, {
      token: marcus.token,
      body: { title: 'Set up CI', assigneeId: kenji.userId, dueDate: '2030-01-01T00:00:00Z' },
    });
    assert.equal(task.status, 201);
    assert.equal(task.body.assignee.id, kenji.userId);
  });

  test('admins can modify anything; deletions keep an activity entry', async () => {
    const mobile = await projectIdByName('Mobile App v2.0'); // Marcus's
    const res = await api('PATCH', `/api/projects/${mobile}`, { token: admin.token, body: { status: 'ON_HOLD' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ON_HOLD');

    const kenjisTask = await taskIdByTitle('Deep linking for shared content');
    assert.equal((await api('DELETE', `/api/tasks/${kenjisTask}`, { token: admin.token })).status, 204);
    const entry = await prisma.activityLog.findFirstOrThrow({ where: { action: 'TASK_DELETED' } });
    assert.deepEqual(entry.metadata, { title: 'Deep linking for shared content' });
    assert.equal(entry.taskId, null);
  });

  test('malformed ids and unknown fields are rejected with 400', async () => {
    assert.equal((await api('GET', '/api/tasks/not-a-uuid', { token: admin.token })).status, 400);
    const mobile = await projectIdByName('Mobile App v2.0');
    const res = await api('PATCH', `/api/projects/${mobile}`, { token: admin.token, body: { createdAt: '2020-01-01T00:00:00Z' } });
    assert.equal(res.status, 400);
  });
});
