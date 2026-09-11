import type { Request, Response } from 'express';
import { Priority, Role, TaskStatus, type Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import { currentUser } from '../middleware/authenticate.js';
import { taskSelect } from './tasks.controller.js';

const OPEN_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW'];
const UPCOMING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every key with its count from a groupBy result (0 when absent), so clients never have to handle gaps. */
function countsBy<K extends string>(keys: readonly K[], rows: { key: K; count: number }[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, rows.find((row) => row.key === key)?.count ?? 0])) as Record<K, number>;
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, count) => total + count, 0);

/** GET /api/dashboard/admin/summary: headline numbers for the whole workspace (aggregated in the database). */
export async function adminSummary(req: Request, res: Response): Promise<void> {
  currentUser(req);
  const [projectCount, tasksByStatus, usersByRole] = await Promise.all([
    prisma.project.count(),
    prisma.task.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.user.groupBy({ by: ['role'], where: { isActive: true }, _count: { _all: true } }),
  ]);

  const byStatus = countsBy(
    Object.values(TaskStatus),
    tasksByStatus.map((row) => ({ key: row.status, count: row._count._all })),
  );
  const byRole = countsBy(
    Object.values(Role),
    usersByRole.map((row) => ({ key: row.role, count: row._count._all })),
  );

  res.json({
    projects: { total: projectCount },
    tasks: { total: sum(byStatus), overdue: byStatus.OVERDUE, byStatus },
    activeUsers: { total: sum(byRole), byRole },
  });
}

/** GET /api/dashboard/pm/summary: the PM's projects with progress, open work by priority, and what's due soon. */
export async function pmSummary(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const now = new Date();
  const ownTasks: Prisma.TaskWhereInput = { project: { ownerId: user.id } };
  const openOwnTasks: Prisma.TaskWhereInput = { ...ownTasks, status: { in: OPEN_STATUSES } };

  const [projects, perProjectStatus, openByPriority, upcoming] = await Promise.all([
    prisma.project.findMany({
      where: { ownerId: user.id },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      select: { id: true, name: true, status: true, dueDate: true },
    }),
    prisma.task.groupBy({ by: ['projectId', 'status'], where: ownTasks, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['priority'], where: openOwnTasks, _count: { _all: true } }),
    prisma.task.findMany({
      where: { ...openOwnTasks, dueDate: { gte: now, lte: new Date(now.getTime() + UPCOMING_DAYS * DAY_MS) } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 10,
      select: taskSelect,
    }),
  ]);

  res.json({
    projects: projects.map((project) => {
      const byStatus = countsBy(
        Object.values(TaskStatus),
        perProjectStatus
          .filter((row) => row.projectId === project.id)
          .map((row) => ({ key: row.status, count: row._count._all })),
      );
      return { ...project, tasks: { total: sum(byStatus), done: byStatus.DONE, overdue: byStatus.OVERDUE } };
    }),
    openTasksByPriority: countsBy(
      Object.values(Priority),
      openByPriority.map((row) => ({ key: row.priority, count: row._count._all })),
    ),
    upcoming: { withinDays: UPCOMING_DAYS, tasks: upcoming },
  });
}
