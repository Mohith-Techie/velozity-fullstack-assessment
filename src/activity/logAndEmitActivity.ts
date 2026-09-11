import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import type { TxContext } from '../lib/transaction.js';
import { ADMIN_ROOM, devRoom, emitToRooms, pmRoom } from '../realtime/socket.js';
import type { ActionMessage } from './actions.js';

/** One feed item. The live `activity` socket event and GET /api/feed/catchup both use this shape. */
export const activityFeedSelect = {
  id: true,
  action: true,
  message: true,
  metadata: true,
  createdAt: true,
  actor: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
} satisfies Prisma.ActivityLogSelect;

export type ActivityEvent = Prisma.ActivityLogGetPayload<{ select: typeof activityFeedSelect }>;

type Subject = { project: { id: string; name: string }; task: { id: string; title: string } | null };

/**
 * Saves an activity entry about a task, then pushes it in real time to exactly the rooms allowed to see it:
 * `global_admin`, the owning PM's `pm_{id}`, and the assigned developer's `dev_{id}`. Never broadcast globally.
 *
 * Pass the caller's transaction context so the entry commits atomically with the change it describes; the
 * event then goes out only after that commit. `userId` null = system actor (e.g. the overdue cron job).
 */
export async function logAndEmitActivity(
  taskId: string,
  userId: string | null,
  actionMessage: ActionMessage,
  ctx?: TxContext,
): Promise<ActivityEvent> {
  const db = ctx?.tx ?? prisma;
  // Recipients come from the database, as of this write, never from the client.
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { id: true, title: true, assigneeId: true, project: { select: { id: true, name: true, ownerId: true } } },
  });
  const rooms = [ADMIN_ROOM, pmRoom(task.project.ownerId)];
  if (task.assigneeId) rooms.push(devRoom(task.assigneeId));

  const subject = { project: task.project, task: { id: task.id, title: task.title } };
  return save(db, subject, userId, actionMessage, rooms, ctx);
}

/** The same for project-level events: `global_admin` and the owning PM only (developers have no project access). */
export async function logAndEmitProjectActivity(
  projectId: string,
  userId: string | null,
  actionMessage: ActionMessage,
  ctx?: TxContext,
): Promise<ActivityEvent> {
  const db = ctx?.tx ?? prisma;
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, name: true, ownerId: true },
  });
  return save(db, { project, task: null }, userId, actionMessage, [ADMIN_ROOM, pmRoom(project.ownerId)], ctx);
}

async function save(
  db: Prisma.TransactionClient,
  subject: Subject,
  userId: string | null,
  { action, message, metadata }: ActionMessage,
  rooms: string[],
  ctx: TxContext | undefined,
): Promise<ActivityEvent> {
  const actor = userId
    ? await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true } })
    : null;
  // Scalars only; the related names come from rows already loaded above. Selecting several relations on a
  // write makes Prisma 7.10 run its follow-up reads concurrently on one pg connection, which pg deprecates
  // (and pg@9 will reject).
  const row = await db.activityLog.create({
    data: { action, message, metadata, actorId: userId, projectId: subject.project.id, taskId: subject.task?.id },
    select: { id: true, action: true, message: true, metadata: true, createdAt: true },
  });
  const event: ActivityEvent = {
    ...row,
    actor,
    project: { id: subject.project.id, name: subject.project.name },
    task: subject.task,
  };

  const emit = () => emitToRooms(rooms, event);
  if (ctx) ctx.afterCommit(emit);
  else emit();
  return event;
}
