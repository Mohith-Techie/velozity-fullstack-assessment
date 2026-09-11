import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { prisma } from '../src/lib/prisma.js';
import { api, baseUrl, login, startTestServer, taskIdByTitle, type Session } from './helpers.js';

type NotificationEvent = {
  notification: { id: string; type: string; message: string; isRead: boolean; task: { id: string } | null };
  unreadCount: number;
};
type ListedNotification = { id: string; isRead: boolean; createdAt: string };

const openSockets: Socket[] = [];

function connectWith(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    openSockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function collect<T>(socket: Socket, event: string): T[] {
  const received: T[] = [];
  socket.on(event, (payload: T) => received.push(payload));
  return received;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
const unreadInDb = (userId: string) => prisma.notification.count({ where: { recipientId: userId, isRead: false } });

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

describe('notifications', () => {
  test('assigning a task notifies that developer, live and in the database, and nobody else', async () => {
    const [danielSocket, kenjiSocket, priyaSocket] = await Promise.all([
      connectWith(daniel.token),
      connectWith(kenji.token),
      connectWith(priya.token),
    ]);
    const toDaniel = collect<NotificationEvent>(danielSocket, 'notification');
    const toKenji = collect<NotificationEvent>(kenjiSocket, 'notification');
    const toPriya = collect<NotificationEvent>(priyaSocket, 'notification');

    const taskId = await taskIdByTitle('Load test checkout at 3x peak traffic'); // Priya's project, assigned to Emma
    const res = await api('PATCH', `/api/tasks/${taskId}`, { token: priya.token, body: { assigneeId: daniel.userId } });
    assert.equal(res.status, 200);
    await settle();

    assert.equal(toDaniel.length, 1);
    assert.equal(toDaniel[0]?.notification.type, 'TASK_ASSIGNED');
    assert.equal(toDaniel[0]?.notification.message, 'Priya Sharma assigned you "Load test checkout at 3x peak traffic"');
    assert.equal(toDaniel[0]?.notification.task?.id, taskId);
    assert.equal(toDaniel[0]?.unreadCount, await unreadInDb(daniel.userId));
    assert.deepEqual(toKenji, []);
    assert.deepEqual(toPriya, []);
  });

  test('a developer moving a task to review notifies the owning PM only', async () => {
    const [priyaSocket, marcusSocket, adminSocket] = await Promise.all([
      connectWith(priya.token),
      connectWith(marcus.token),
      connectWith(admin.token),
    ]);
    const toPriya = collect<NotificationEvent>(priyaSocket, 'notification');
    const toMarcus = collect<NotificationEvent>(marcusSocket, 'notification');
    const toAdmin = collect<NotificationEvent>(adminSocket, 'notification');

    const taskId = await taskIdByTitle('Server-side pagination for invoices view'); // Priya's project, Daniel's task
    const res = await api('PATCH', `/api/tasks/${taskId}`, { token: daniel.token, body: { status: 'IN_REVIEW' } });
    assert.equal(res.status, 200);
    await settle();

    assert.equal(toPriya.length, 1);
    assert.equal(toPriya[0]?.notification.type, 'TASK_STATUS_CHANGED');
    assert.equal(toPriya[0]?.notification.message, 'Daniel Okafor moved "Server-side pagination for invoices view" to review');
    assert.equal(toPriya[0]?.unreadCount, await unreadInDb(priya.userId));
    assert.deepEqual(toMarcus, []);
    assert.deepEqual(toAdmin, []);
  });

  test('a PM moving a task to review notifies nobody', async () => {
    const taskId = await taskIdByTitle('Dual-write ledger to the new payments DB'); // Priya's project, Daniel's task
    const before = await prisma.notification.count({ where: { taskId } });
    const res = await api('PATCH', `/api/tasks/${taskId}`, { token: priya.token, body: { status: 'IN_REVIEW' } });
    assert.equal(res.status, 200);
    assert.equal(await prisma.notification.count({ where: { taskId } }), before);
  });

  test('users list and mark only their own notifications, and their other tabs stay in sync', async () => {
    const list = await api('GET', '/api/notifications', { token: daniel.token });
    assert.equal(list.status, 200);
    assert.equal(list.body.unreadCount, await unreadInDb(daniel.userId));
    const own = new Set((await prisma.notification.findMany({ where: { recipientId: daniel.userId } })).map((n) => n.id));
    const items: ListedNotification[] = list.body.data;
    assert.ok(items.length > 0 && items.every((n) => own.has(n.id)));
    const times = items.map((n) => n.createdAt);
    assert.deepEqual(times, [...times].sort().reverse()); // newest first

    const unread = items.find((n) => !n.isRead);
    assert.ok(unread, 'expected the assignment notification from the first test');
    // Another user can't mark it: 404 (no hint that it exists), and it stays unread.
    assert.equal((await api('PATCH', `/api/notifications/${unread.id}/read`, { token: kenji.token })).status, 404);
    assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: unread.id } })).isRead, false);

    const otherTab = await connectWith(daniel.token);
    const readEvents = collect<{ ids: string[] | 'all'; unreadCount: number }>(otherTab, 'notifications_read');
    const marked = await api('PATCH', `/api/notifications/${unread.id}/read`, { token: daniel.token });
    assert.equal(marked.status, 200);
    assert.equal(marked.body.unreadCount, await unreadInDb(daniel.userId));
    await settle();
    assert.deepEqual(readEvents[0], { ids: [unread.id], unreadCount: marked.body.unreadCount });

    const all = await api('POST', '/api/notifications/read-all', { token: daniel.token });
    assert.equal(all.status, 200);
    assert.equal(all.body.unreadCount, 0);
    assert.equal(await unreadInDb(daniel.userId), 0);
  });

  test('malformed ids and out-of-range limits get structured 400s', async () => {
    const badId = await api('PATCH', '/api/notifications/not-a-uuid/read', { token: daniel.token });
    assert.equal(badId.status, 400);
    assert.equal(badId.body.error.code, 'VALIDATION_ERROR');
    assert.equal((await api('GET', '/api/notifications?limit=500', { token: daniel.token })).status, 400);
  });
});
