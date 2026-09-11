import type { Request, Response } from 'express';
import { z } from 'zod';
import { fieldChanges, taskActions, type ActionMessage } from '../activity/actions.js';
import { logAndEmitActivity } from '../activity/logAndEmitActivity.js';
import { canManageProject, taskAccess, taskScope, type TaskAccess } from '../auth/policies.js';
import type { AuthUser } from '../auth/authUser.js';
import { Priority, Role, TaskStatus, type Prisma } from '../generated/prisma/client.js';
import { forbidden, notFound, unprocessable } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { inTransaction } from '../lib/transaction.js';
import { notifyUser } from '../notifications/notify.js';
import { isoDateTime, projectIdParams, taskIdParams } from '../lib/validation.js';
import { currentUser } from '../middleware/authenticate.js';

export const taskSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  projectId: true,
  assigneeId: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, name: true, ownerId: true } },
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

/** Developers move their own work forward; approving it into DONE is the project manager's call. */
const DEVELOPER_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW'] as const;
type DeveloperStatus = (typeof DEVELOPER_STATUSES)[number];
const isDeveloperStatus = (status: TaskStatus): status is DeveloperStatus =>
  (DEVELOPER_STATUSES as readonly TaskStatus[]).includes(status);

const taskFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable(),
  // OVERDUE belongs to the overdue cron job; no API caller may set it.
  status: z.enum(TaskStatus).exclude(['OVERDUE']),
  priority: z.enum(Priority),
  dueDate: isoDateTime.nullable(),
  assigneeId: z.uuid().nullable(),
};

const createTaskBody = z.strictObject(taskFields).partial().required({ title: true });
const managerUpdateBody = z
  .strictObject(taskFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');
const developerUpdateBody = z.strictObject({ status: z.enum(TaskStatus) });

type TaskChanges = z.infer<typeof managerUpdateBody>;

async function findTaskOrThrow(taskId: string): Promise<TaskRow> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: taskSelect });
  if (!task) throw notFound('Task');
  return task;
}

const noTaskAccess = (user: AuthUser) =>
  forbidden(
    user.role === Role.DEVELOPER
      ? 'You can only access tasks assigned to you'
      : 'You can only access tasks in your own projects',
  );

/** Tasks may only be assigned to active developers; the foreign key alone can't check the role. */
async function findAssignableDeveloper(userId: string) {
  const developer = await prisma.user.findFirst({
    where: { id: userId, role: Role.DEVELOPER, isActive: true },
    select: { id: true, name: true },
  });
  if (!developer) throw unprocessable('assigneeId must reference an active developer');
  return developer;
}

/** Developers may change exactly one thing on their own tasks: the status, and only up to IN_REVIEW. */
function parseDeveloperUpdate(body: unknown): TaskChanges {
  const fields = typeof body === 'object' && body !== null ? Object.keys(body) : [];
  const disallowed = fields.filter((field) => field !== 'status');
  if (disallowed.length > 0) {
    throw forbidden(`Developers can only change a task's status (not allowed: ${disallowed.join(', ')})`);
  }
  const { status } = developerUpdateBody.parse(body);
  if (!isDeveloperStatus(status)) {
    throw forbidden(`Developers can only set status to ${DEVELOPER_STATUSES.join(', ')}`);
  }
  return { status };
}

const parseUpdate = (access: Exclude<TaskAccess, null>, body: unknown): TaskChanges =>
  access === 'manage' ? managerUpdateBody.parse(body) : parseDeveloperUpdate(body);

/** Keeps completedAt in step with the DONE status. */
function completion(before: TaskStatus, after: TaskStatus | undefined): { completedAt?: Date | null } {
  if (!after || after === before) return {};
  if (after === 'DONE') return { completedAt: new Date() };
  if (before === 'DONE') return { completedAt: null };
  return {};
}

/** Feed entries for an update: one per status move, reassignment and edited field. */
function describeUpdate(
  before: TaskRow,
  changes: TaskChanges,
  assignee: { id: string; name: string } | null,
): ActionMessage[] {
  const { status, assigneeId, ...fields } = changes;
  const title = changes.title ?? before.title;
  const entries: ActionMessage[] = [];
  if (status !== undefined && status !== before.status) {
    entries.push(taskActions.statusChanged(title, before.status, status));
  }
  if (assigneeId !== undefined && assigneeId !== before.assigneeId) {
    entries.push(taskActions.assigned(title, assignee));
  }
  for (const change of fieldChanges(before, fields, ['description'])) {
    entries.push(taskActions.updated(title, change));
  }
  return entries;
}

/** GET /api/tasks/:taskId */
export async function getTask(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { taskId } = taskIdParams.parse(req.params);
  const task = await findTaskOrThrow(taskId);
  if (!taskAccess(user, task)) throw noTaskAccess(user);
  res.json(task);
}

/** POST /api/projects/:projectId/tasks: owner PM or admin. */
export async function createTask(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { projectId } = projectIdParams.parse(req.params);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, ownerId: true } });
  if (!project) throw notFound('Project');
  if (!canManageProject(user, project)) throw forbidden('You can only add tasks to your own projects');

  const input = createTaskBody.parse(req.body);
  const assignee = input.assigneeId ? await findAssignableDeveloper(input.assigneeId) : null;

  const task = await inTransaction(async (ctx) => {
    const created = await ctx.tx.task.create({
      data: { ...input, projectId: project.id, createdById: user.id, ...completion('TODO', input.status) },
      select: taskSelect,
    });
    await logAndEmitActivity(created.id, user.id, taskActions.created(created.title), ctx);
    if (assignee) {
      await logAndEmitActivity(created.id, user.id, taskActions.assigned(created.title, assignee), ctx);
      await notifyUser(ctx, assignee.id, 'TASK_ASSIGNED', `${user.name} assigned you "${created.title}"`, created);
    }
    return created;
  });
  res.status(201).location(`/api/tasks/${task.id}`).json(task);
}

/**
 * PATCH /api/tasks/:taskId
 * - admin / owning PM: any field (assignee must be a developer);
 * - assigned developer: status only, TODO → IN_PROGRESS → IN_REVIEW;
 * - anyone else: 403, whatever their token says.
 */
export async function updateTask(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { taskId } = taskIdParams.parse(req.params);
  const task = await findTaskOrThrow(taskId);

  // Row-level check: compare req.user.id with the owner/assignee ids stored in the database.
  const access = taskAccess(user, task);
  if (!access) throw noTaskAccess(user);

  const changes = parseUpdate(access, req.body);
  const assignee = changes.assigneeId ? await findAssignableDeveloper(changes.assigneeId) : null;

  const updated = await inTransaction(async (ctx) => {
    const row = await ctx.tx.task.update({
      // Ownership is re-asserted in the write itself: if the task changed hands after the check
      // above, nothing matches and the request fails instead of writing.
      where: { id: task.id, AND: [taskScope(user)] },
      data: { ...changes, ...completion(task.status, changes.status) },
      select: taskSelect,
    });
    // Saved in this transaction; the socket events go out only once it commits.
    for (const entry of describeUpdate(task, changes, assignee)) {
      await logAndEmitActivity(task.id, user.id, entry, ctx);
    }
    // Notifications: the developer a task was just assigned to, and the project's PM when a developer
    // hands work in for review. Also committed with the change, and pushed only after the commit.
    if (assignee && assignee.id !== task.assigneeId) {
      await notifyUser(ctx, assignee.id, 'TASK_ASSIGNED', `${user.name} assigned you "${row.title}"`, row);
    }
    if (user.role === Role.DEVELOPER && changes.status === 'IN_REVIEW' && task.status !== 'IN_REVIEW') {
      await notifyUser(ctx, row.project.ownerId, 'TASK_STATUS_CHANGED', `${user.name} moved "${row.title}" to review`, row);
    }
    return row;
  });
  res.json(updated);
}

/** DELETE /api/tasks/:taskId: owner PM or admin. */
export async function deleteTask(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { taskId } = taskIdParams.parse(req.params);
  const task = await findTaskOrThrow(taskId);
  if (taskAccess(user, task) !== 'manage') throw forbidden('Only the project owner or an admin can delete tasks');

  await inTransaction(async (ctx) => {
    // Logged first, while the task (and so its recipients) still exists. ON DELETE SET NULL then clears
    // task_id, so the title survives in the message and metadata.
    await logAndEmitActivity(task.id, user.id, taskActions.deleted(task.title), ctx);
    await ctx.tx.task.delete({ where: { id: task.id, AND: [taskScope(user)] } });
  });
  res.status(204).end();
}
