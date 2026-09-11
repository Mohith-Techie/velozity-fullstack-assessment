import type { NotificationType, Prisma } from '../generated/prisma/client.js';
import type { TxContext } from '../lib/transaction.js';
import { emitNotification } from '../realtime/socket.js';

/** One notification as clients see it, in the `notification` socket event and in GET /api/notifications. */
export const notificationSelect = {
  id: true,
  type: true,
  message: true,
  isRead: true,
  createdAt: true,
  project: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
} satisfies Prisma.NotificationSelect;

export type NotificationItem = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>;

export interface NotificationEvent {
  notification: NotificationItem;
  /** The recipient's unread count including this one, so badges never drift. */
  unreadCount: number;
}

/**
 * Stores a notification in the caller's transaction and, once that commits, pushes it to the recipient's
 * personal room (`user_{id}`) with their new unread count.
 */
export async function notifyUser(
  ctx: TxContext,
  recipientId: string,
  type: NotificationType,
  message: string,
  task: { id: string; title: string; project: { id: string; name: string } },
): Promise<void> {
  // Scalar columns only on the write (see logAndEmitActivity); the related names come from `task`.
  const row = await ctx.tx.notification.create({
    data: { recipientId, type, message, projectId: task.project.id, taskId: task.id },
    select: { id: true, type: true, message: true, isRead: true, createdAt: true },
  });
  const unreadCount = await ctx.tx.notification.count({ where: { recipientId, isRead: false } });

  const notification: NotificationItem = {
    ...row,
    project: { id: task.project.id, name: task.project.name },
    task: { id: task.id, title: task.title },
  };
  ctx.afterCommit(() => emitNotification(recipientId, { notification, unreadCount }));
}
