import type { Request, Response } from 'express';
import { z } from 'zod';
import { notFound } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { currentUser } from '../middleware/authenticate.js';
import { notificationSelect } from '../notifications/notify.js';
import { emitNotificationsRead } from '../realtime/socket.js';

const listQuery = z.strictObject({ limit: z.coerce.number().int().min(1).max(50).default(20) });
const notificationIdParams = z.object({ notificationId: z.uuid() });

// Served by the notifications(recipient_id, is_read, created_at) index.
const unreadCountOf = (userId: string) => prisma.notification.count({ where: { recipientId: userId, isRead: false } });

/** GET /api/notifications: the caller's newest notifications and their unread count. */
export async function listNotifications(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { limit } = listQuery.parse(req.query);
  const [data, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { recipientId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: notificationSelect,
    }),
    unreadCountOf(user.id),
  ]);
  res.json({ data, unreadCount });
}

/** PATCH /api/notifications/:notificationId/read: only the recipient can mark it; anyone else gets a 404. */
export async function markNotificationRead(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { notificationId } = notificationIdParams.parse(req.params);
  // The recipient check is part of the UPDATE itself, so it can't be bypassed or raced.
  const { count } = await prisma.notification.updateMany({
    where: { id: notificationId, recipientId: user.id },
    data: { isRead: true },
  });
  if (count === 0) throw notFound('Notification');

  const unreadCount = await unreadCountOf(user.id);
  emitNotificationsRead(user.id, { ids: [notificationId], unreadCount }); // keeps the user's other tabs in sync
  res.json({ id: notificationId, isRead: true, unreadCount });
}

/** POST /api/notifications/read-all */
export async function markAllNotificationsRead(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { count } = await prisma.notification.updateMany({
    where: { recipientId: user.id, isRead: false },
    data: { isRead: true },
  });

  const unreadCount = await unreadCountOf(user.id);
  emitNotificationsRead(user.id, { ids: 'all', unreadCount });
  res.json({ updated: count, unreadCount });
}
