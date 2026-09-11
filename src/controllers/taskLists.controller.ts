import type { Request, Response } from 'express';
import { z } from 'zod';
import { taskScope } from '../auth/policies.js';
import { Priority, Role, TaskStatus, type Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import { dateBound, listParam, paginationQuery } from '../lib/validation.js';
import { currentUser } from '../middleware/authenticate.js';
import { taskSelect } from './tasks.controller.js';

const SORTS = {
  dueDate: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
  '-dueDate': [{ dueDate: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
  priority: [{ priority: 'asc' }, { dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
  '-priority': [{ priority: 'desc' }, { dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
  createdAt: [{ createdAt: 'asc' }, { id: 'asc' }],
  '-createdAt': [{ createdAt: 'desc' }, { id: 'desc' }],
} satisfies Record<string, Prisma.TaskOrderByWithRelationInput[]>;

// Query parameters for every task list, validated before anything touches the database:
//   ?status=TODO,IN_PROGRESS        ?priority=HIGH&priority=URGENT      (comma-separated or repeated)
//   ?dueFrom=2026-09-01&dueTo=2026-09-30   (bare dates are whole UTC days; ISO date-times also accepted)
//   ?projectId=<uuid>  ?assigneeId=<uuid>  ?sort=-priority  ?limit=20&offset=40
// Strict objects: an unknown or misspelled parameter (`stauts`) is a 400, not a silently unfiltered list.
const sharedFilters = {
  ...paginationQuery.shape,
  status: listParam(z.enum(TaskStatus)),
  priority: listParam(z.enum(Priority)),
  dueFrom: dateBound('start').optional(),
  dueTo: dateBound('end').optional(),
  projectId: z.uuid().optional(),
  sort: z.enum(Object.keys(SORTS) as (keyof typeof SORTS)[]).default('dueDate'),
};

const validDueRange = (query: { dueFrom?: Date | undefined; dueTo?: Date | undefined }) =>
  !query.dueFrom || !query.dueTo || query.dueFrom <= query.dueTo;
const dueRangeError = { path: ['dueTo'], message: 'must be on or after dueFrom' };

/** Admin and PM lists can also filter by assignee. */
export const managerTaskListQuery = z
  .strictObject({ ...sharedFilters, assigneeId: z.uuid().optional() })
  .refine(validDueRange, dueRangeError);

/** A developer's list is always their own tasks, so `assigneeId` is not accepted. */
export const developerTaskListQuery = z.strictObject(sharedFilters).refine(validDueRange, dueRangeError);

type TaskListQuery = z.infer<typeof managerTaskListQuery>;

/** One page of tasks: the role scope ANDed with the filters, so no filter combination can widen access. */
async function findTaskPage(scope: Prisma.TaskWhereInput, query: TaskListQuery | z.infer<typeof developerTaskListQuery>) {
  const where: Prisma.TaskWhereInput = {
    AND: [
      scope,
      {
        status: query.status && { in: query.status },
        priority: query.priority && { in: query.priority },
        projectId: query.projectId,
        assigneeId: 'assigneeId' in query ? query.assigneeId : undefined,
        dueDate: query.dueFrom || query.dueTo ? { gte: query.dueFrom, lte: query.dueTo } : undefined,
      },
    ],
  };
  const [data, total] = await Promise.all([
    prisma.task.findMany({ where, orderBy: SORTS[query.sort], take: query.limit, skip: query.offset, select: taskSelect }),
    prisma.task.count({ where }),
  ]);
  return { data, pagination: { total, limit: query.limit, offset: query.offset } };
}

/** GET /api/dashboard/admin/tasks: every task in every project. */
export async function adminTaskList(req: Request, res: Response): Promise<void> {
  currentUser(req);
  res.json(await findTaskPage({}, managerTaskListQuery.parse(req.query)));
}

/** GET /api/dashboard/pm/tasks: tasks in the projects this PM owns. */
export async function pmTaskList(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  res.json(await findTaskPage({ project: { ownerId: user.id } }, managerTaskListQuery.parse(req.query)));
}

/** GET /api/dashboard/developer/tasks: tasks assigned to this developer. */
export async function developerTaskList(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  res.json(await findTaskPage({ assigneeId: user.id }, developerTaskListQuery.parse(req.query)));
}

/** GET /api/tasks: the caller's own dashboard list, whatever their role. */
export async function listTasks(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const schema = user.role === Role.DEVELOPER ? developerTaskListQuery : managerTaskListQuery;
  res.json(await findTaskPage(taskScope(user), schema.parse(req.query)));
}
