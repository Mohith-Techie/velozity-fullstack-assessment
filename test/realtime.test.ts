import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { io as connect, type Socket } from 'socket.io-client';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { api, baseUrl, login, projectIdByName, startTestServer, taskIdByTitle, type Session } from './helpers.js';

interface FeedEvent {
  id: string;
  action: string;
  message: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  task: { id: string; title: string } | null;
}

const openSockets: Socket[] = [];

/** Resolves once connected; rejects with the server's connect_error (`message` + `data.code`). */
function connectWith(token: string | undefined): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(baseUrl, {
      auth: token === undefined ? {} : { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    openSockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

/** Every `activity` event the socket receives, in order. */
function collect(socket: Socket): FeedEvent[] {
  const events: FeedEvent[] = [];
  socket.on('activity', (event: FeedEvent) => events.push(event));
  return events;
}

/** Room fan-out is asynchronous: give events time to arrive (or, for negative checks, to not arrive). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

const signAccessToken = (userId: string, expiresInSeconds: number) =>
  jwt.sign({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    issuer: 'pm-dashboard-api',
    audience: 'pm-dashboard',
  });

let stopServer: () => Promise<void>;
let admin: Session, priya: Session, marcus: Session, daniel: Session, kenji: Session;

before(async () => {
  stopServer = await startTestServer();
  [admin, priya, marcus, daniel, kenji] = await Promise.all([
    login('admin@example.com'),
    login('priya.sharma@example.com'),
    login('marcus.chen@example.com'),
    login('daniel.okafor@example.com'),
    login('kenji.tanaka@example.com'),
  ]);
});

after(async () => {
  for (const socket of openSockets) socket.close();
  await stopServer();
});

describe('socket authentication', () => {
  test('rejects a handshake without a valid, unexpired access token', async () => {
    await assert.rejects(connectWith(undefined), { message: 'Missing access token' });
    await assert.rejects(connectWith('not-a-jwt'), { message: 'Invalid access token' });
    await assert.rejects(connectWith(signAccessToken(daniel.userId, -10)), (error: Error & { data?: { code?: string } }) => {
      assert.equal(error.data?.code, 'TOKEN_EXPIRED');
      return true;
    });
  });

  test('drops the socket when its access token expires', async () => {
    const socket = await connectWith(signAccessToken(daniel.userId, 2));
    const warned = new Promise<void>((resolve) => socket.once('session_expired', () => resolve()));
    const reason = new Promise<string>((resolve) => socket.once('disconnect', (why) => resolve(why)));
    await warned;
    assert.equal(await reason, 'io server disconnect');
  });
});

describe('activity routing', () => {
  test('a task event reaches global_admin, the owning PM and the assignee, and nobody else', async () => {
    const [adminSocket, priyaSocket, marcusSocket, danielSocket, kenjiSocket] = await Promise.all([
      connectWith(admin.token),
      connectWith(priya.token),
      connectWith(marcus.token),
      connectWith(daniel.token),
      connectWith(kenji.token),
    ]);
    const feeds = {
      admin: collect(adminSocket),
      priya: collect(priyaSocket),
      marcus: collect(marcusSocket),
      daniel: collect(danielSocket),
      kenji: collect(kenjiSocket),
    };

    const taskId = await taskIdByTitle('Server-side pagination for invoices view'); // Priya's project, Daniel's task
    const res = await api('PATCH', `/api/tasks/${taskId}`, { token: daniel.token, body: { status: 'IN_REVIEW' } });
    assert.equal(res.status, 200);
    await settle();

    for (const feed of [feeds.admin, feeds.priya, feeds.daniel]) {
      assert.equal(feed.length, 1);
      assert.equal(feed[0]?.message, 'moved "Server-side pagination for invoices view" from In Progress to In Review');
      assert.equal(feed[0]?.actor?.id, daniel.userId);
    }
    assert.deepEqual(feeds.marcus, []);
    assert.deepEqual(feeds.kenji, []);
  });

  test('project events go to global_admin and the owning PM only', async () => {
    const [adminSocket, marcusSocket, priyaSocket, kenjiSocket] = await Promise.all([
      connectWith(admin.token),
      connectWith(marcus.token),
      connectWith(priya.token),
      connectWith(kenji.token),
    ]);
    const feeds = {
      admin: collect(adminSocket),
      marcus: collect(marcusSocket),
      priya: collect(priyaSocket),
      kenji: collect(kenjiSocket),
    };

    const mobile = await projectIdByName('Mobile App v2.0'); // Marcus's project; Kenji has tasks in it
    const res = await api('PATCH', `/api/projects/${mobile}`, { token: marcus.token, body: { status: 'ON_HOLD' } });
    assert.equal(res.status, 200);
    await settle();

    assert.equal(feeds.admin[0]?.message, 'changed the status of the project "Mobile App v2.0" to On Hold');
    assert.equal(feeds.marcus.length, 1);
    assert.deepEqual(feeds.priya, []);
    assert.deepEqual(feeds.kenji, []);
  });

  test('a rejected write emits nothing', async () => {
    const sockets = await Promise.all([connectWith(admin.token), connectWith(priya.token), connectWith(daniel.token)]);
    const feeds = sockets.map(collect);

    const danielsTask = await taskIdByTitle('Dual-write ledger to the new payments DB');
    const res = await api('PATCH', `/api/tasks/${danielsTask}`, { token: kenji.token, body: { status: 'IN_REVIEW' } });
    assert.equal(res.status, 403);
    await settle();

    for (const feed of feeds) assert.deepEqual(feed, []);
  });
});

describe('GET /api/feed/catchup', () => {
  async function catchup(session: Session, query = ''): Promise<FeedEvent[]> {
    const res = await api('GET', `/api/feed/catchup${query}`, { token: session.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.data;
  }

  test('admins get the 20 newest events overall, newest first', async () => {
    const events = await catchup(admin);
    const newest = await prisma.activityLog.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      select: { id: true },
    });
    assert.deepEqual(
      events.map((event) => event.id),
      newest.map((event) => event.id),
    );
  });

  test('PMs only get events from their own projects', async () => {
    const events = await catchup(marcus);
    assert.ok(events.length > 0 && events.length <= 20);
    const own = await prisma.project.findMany({ where: { ownerId: marcus.userId }, select: { id: true } });
    const ownIds = own.map((project) => project.id);
    assert.ok(events.every((event) => event.project && ownIds.includes(event.project.id)));
  });

  test('developers only get events on tasks assigned to them', async () => {
    const events = await catchup(daniel);
    assert.ok(events.length > 0);
    const own = await prisma.task.findMany({ where: { assigneeId: daniel.userId }, select: { id: true } });
    const ownIds = own.map((task) => task.id);
    assert.ok(events.every((event) => event.task && ownIds.includes(event.task.id)));
  });

  test('`since` returns only what was missed', async () => {
    const [latest] = await catchup(priya);
    assert.ok(latest);
    const since = `?since=${encodeURIComponent(latest.createdAt)}`;
    assert.deepEqual(await catchup(priya, since), []);

    const taskId = await taskIdByTitle('PCI scope review & documentation'); // in Priya's project
    await api('PATCH', `/api/tasks/${taskId}`, { token: priya.token, body: { priority: 'HIGH' } });
    const missed = await catchup(priya, since);
    assert.equal(missed.length, 1);
    assert.equal(missed[0]?.message, 'changed the priority of "PCI scope review & documentation" to High');
  });

  test('requires authentication', async () => {
    assert.equal((await api('GET', '/api/feed/catchup')).status, 401);
  });
});
