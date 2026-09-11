import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { runOverdueSweep } from '../src/jobs/overdueTasks.js';
import { prisma } from '../src/lib/prisma.js';
import { api, baseUrl, login, projectIdByName, startTestServer, type Session } from './helpers.js';

type Task = { status: string; priority: string; dueDate: string | null; assigneeId: string | null; project: { ownerId: string } };
type FeedEvent = { message: string; actor: { id: string } | null };

const HOUR = 3_600_000;
const openSockets: Socket[] = [];

function connectWith(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    openSockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function collect(socket: Socket): FeedEvent[] {
  const events: FeedEvent[] = [];
  socket.on('activity', (event: FeedEvent) => events.push(event));
  return events;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

let stopServer: () => Promise<void>;
let admin: Session, priya: Session, marcus: Session, daniel: Session;

before(async () => {
  stopServer = await startTestServer();
  [admin, priya, marcus, daniel] = await Promise.all([
    login('admin@example.com'),
    login('priya.sharma@example.com'),
    login('marcus.chen@example.com'),
    login('daniel.okafor@example.com'),
  ]);
});

after(async () => {
  for (const socket of openSockets) socket.close();
  await stopServer();
});

describe('overdue sweep', () => {
  test('flags past-due open tasks in batches, logs them as the system, and emits only to the right rooms', async () => {
    const mobile = await projectIdByName('Mobile App v2.0'); // Marcus's project
    const past = new Date(Date.now() - 2 * HOUR);
    const openStatuses = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'TODO', 'IN_PROGRESS'] as const;
    const created = await prisma.task.createManyAndReturn({
      data: [
        ...openStatuses.map((status, i) => ({
          title: `Past due ${i}`,
          status,
          dueDate: past,
          projectId: mobile,
          assigneeId: daniel.userId,
        })),
        { title: 'Done but late', status: 'DONE', dueDate: past, completedAt: past, projectId: mobile },
        { title: 'No due date', status: 'TODO', projectId: mobile },
        { title: 'Due tomorrow', status: 'TODO', dueDate: new Date(Date.now() + 24 * HOUR), projectId: mobile },
      ],
      select: { id: true },
    });
    const ids = created.map((task) => task.id);

    const [adminSocket, marcusSocket, danielSocket, priyaSocket] = await Promise.all([
      connectWith(admin.token),
      connectWith(marcus.token),
      connectWith(daniel.token),
      connectWith(priya.token),
    ]);
    const feeds = {
      admin: collect(adminSocket),
      marcus: collect(marcusSocket),
      daniel: collect(danielSocket),
      priya: collect(priyaSocket),
    };

    // batchSize 2 forces three batches (2 + 2 + 1).
    assert.deepEqual(await runOverdueSweep({ batchSize: 2, pauseMs: 0 }), { flagged: 5, batches: 3, skipped: false });

    const after = await prisma.task.findMany({ where: { id: { in: ids } }, select: { title: true, status: true } });
    const statusOf = Object.fromEntries(after.map((task) => [task.title, task.status]));
    for (let i = 0; i < openStatuses.length; i++) assert.equal(statusOf[`Past due ${i}`], 'OVERDUE');
    assert.equal(statusOf['Done but late'], 'DONE');
    assert.equal(statusOf['No due date'], 'TODO');
    assert.equal(statusOf['Due tomorrow'], 'TODO');

    const entries = await prisma.activityLog.findMany({
      where: { taskId: { in: ids } },
      select: { action: true, actorId: true, message: true },
    });
    assert.equal(entries.length, 5);
    assert.ok(entries.every((entry) => entry.action === 'TASK_STATUS_CHANGED' && entry.actorId === null));
    assert.ok(entries.some((entry) => entry.message === 'moved "Past due 2" from In Review to Overdue'));

    await settle();
    for (const feed of [feeds.admin, feeds.marcus, feeds.daniel]) {
      assert.equal(feed.length, 5);
      assert.ok(feed.every((event) => event.actor === null));
    }
    assert.deepEqual(feeds.priya, []); // not her project

    // Idempotent: nothing left to flag.
    assert.deepEqual(await runOverdueSweep({ batchSize: 2, pauseMs: 0 }), { flagged: 0, batches: 0, skipped: false });
  });
});

describe('dashboard task lists', () => {
  test('each dashboard is reachable only by its own role and shows only that role’s tasks', async () => {
    assert.equal((await api('GET', '/api/dashboard/admin/tasks', { token: priya.token })).status, 403);
    assert.equal((await api('GET', '/api/dashboard/pm/tasks', { token: daniel.token })).status, 403);
    assert.equal((await api('GET', '/api/dashboard/developer/tasks', { token: admin.token })).status, 403);

    const pm = await api('GET', '/api/dashboard/pm/tasks', { token: marcus.token });
    assert.equal(pm.status, 200);
    assert.ok(pm.body.data.length > 0 && pm.body.data.every((t: Task) => t.project.ownerId === marcus.userId));

    const dev = await api('GET', '/api/dashboard/developer/tasks', { token: daniel.token });
    assert.equal(dev.status, 200);
    assert.ok(dev.body.data.length > 0 && dev.body.data.every((t: Task) => t.assigneeId === daniel.userId));
  });

  test('filters by status and priority (comma-separated or repeated) with totals for pagination', async () => {
    const res = await api('GET', '/api/dashboard/admin/tasks?status=TODO,IN_PROGRESS&priority=HIGH&priority=URGENT&limit=2', {
      token: admin.token,
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length <= 2);
    assert.ok(
      res.body.data.every((t: Task) => ['TODO', 'IN_PROGRESS'].includes(t.status) && ['HIGH', 'URGENT'].includes(t.priority)),
    );
    const total = await prisma.task.count({
      where: { status: { in: ['TODO', 'IN_PROGRESS'] }, priority: { in: ['HIGH', 'URGENT'] } },
    });
    assert.deepEqual(res.body.pagination, { total, limit: 2, offset: 0 });
  });

  test('filters by due-date range (bare dates cover the whole day) and sorts', async () => {
    const from = new Date();
    const to = new Date(Date.now() + 7 * 24 * HOUR);
    const toDay = to.toISOString().slice(0, 10);
    const res = await api('GET', `/api/dashboard/admin/tasks?dueFrom=${from.toISOString()}&dueTo=${toDay}&sort=-dueDate`, {
      token: admin.token,
    });
    assert.equal(res.status, 200);
    const dues = res.body.data.map((t: Task) => new Date(t.dueDate ?? 0).getTime());
    assert.ok(dues.length > 0);
    assert.ok(dues.every((due: number) => due >= from.getTime() && due <= new Date(`${toDay}T23:59:59.999Z`).getTime()));
    assert.deepEqual(dues, [...dues].sort((a, b) => b - a));
  });
});

describe('structured errors', () => {
  test('invalid query parameters get a 400 listing every problem, before any query runs', async () => {
    const res = await api('GET', '/api/dashboard/admin/tasks?status=DONE,DELAYED&dueFrom=yesterday&stauts=TODO', {
      token: admin.token,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.message, 'Request validation failed');
    const byField = Object.fromEntries(
      res.body.error.details.map((d: { field: string; message: string }) => [d.field, d.message]),
    );
    assert.match(byField['status.1'], /expected one of/);
    assert.equal(byField.dueFrom, 'must be a date (2026-09-30) or an ISO date-time (2026-09-30T17:00:00Z)');
    assert.match(byField.stauts, /Unrecognized key/);
  });

  test('dueFrom after dueTo, and assignee filters on a developer list, are rejected readably', async () => {
    const range = await api('GET', '/api/dashboard/admin/tasks?dueFrom=2026-10-01&dueTo=2026-09-01', { token: admin.token });
    assert.equal(range.status, 400);
    assert.deepEqual(range.body.error.details, [{ field: 'dueTo', message: 'must be on or after dueFrom', code: 'custom' }]);

    const assignee = await api('GET', `/api/dashboard/developer/tasks?assigneeId=${marcus.userId}`, { token: daniel.token });
    assert.equal(assignee.status, 400);
    assert.equal(assignee.body.error.details[0].field, 'assigneeId');
  });

  test('malformed JSON and unknown routes get the same envelope, with no stack traces', async () => {
    const malformed = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"email":',
    });
    const malformedBody = await malformed.json();
    assert.equal(malformed.status, 400);
    assert.deepEqual(malformedBody, { error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });

    const missing = await api('GET', '/api/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');

    for (const body of [malformedBody, missing.body]) {
      assert.doesNotMatch(JSON.stringify(body), /node_modules|\.ts:\d|stack/i);
    }
  });
});

describe('dashboard summaries', () => {
  test('admin summary matches the database', async () => {
    const res = await api('GET', '/api/dashboard/admin/summary', { token: admin.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.projects.total, await prisma.project.count());
    for (const status of ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'OVERDUE'] as const) {
      assert.equal(res.body.tasks.byStatus[status], await prisma.task.count({ where: { status } }), status);
    }
    assert.equal(res.body.tasks.total, await prisma.task.count());
    assert.equal(res.body.tasks.overdue, res.body.tasks.byStatus.OVERDUE);
    assert.deepEqual(res.body.activeUsers, { total: 7, byRole: { ADMIN: 1, PROJECT_MANAGER: 2, DEVELOPER: 4 } });
  });

  test('PM summary covers only their projects, open work by priority, and tasks due within a week', async () => {
    const res = await api('GET', '/api/dashboard/pm/summary', { token: priya.token });
    assert.equal(res.status, 200);
    const names = res.body.projects.map((project: { name: string }) => project.name).sort();
    assert.deepEqual(names, ['Customer Portal Redesign', 'Payments Service Migration']);

    const openHigh = await prisma.task.count({
      where: { project: { ownerId: priya.userId }, status: { in: ['TODO', 'IN_PROGRESS', 'IN_REVIEW'] }, priority: 'HIGH' },
    });
    assert.equal(res.body.openTasksByPriority.HIGH, openHigh);

    const weekAhead = Date.now() + 7 * 24 * HOUR;
    const upcoming: Task[] = res.body.upcoming.tasks;
    assert.ok(upcoming.length > 0);
    assert.ok(upcoming.every((t) => t.project.ownerId === priya.userId && t.dueDate !== null && new Date(t.dueDate).getTime() <= weekAhead));
  });

  test('summaries are reachable only by their own role', async () => {
    assert.equal((await api('GET', '/api/dashboard/admin/summary', { token: priya.token })).status, 403);
    assert.equal((await api('GET', '/api/dashboard/pm/summary', { token: daniel.token })).status, 403);
  });
});
