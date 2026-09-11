import type { Request, Response } from 'express';
import { z } from 'zod';
import { fieldChanges, projectActions } from '../activity/actions.js';
import { logAndEmitProjectActivity } from '../activity/logAndEmitActivity.js';
import { canManageProject, projectScope } from '../auth/policies.js';
import { ProjectStatus, Role, type Prisma } from '../generated/prisma/client.js';
import { forbidden, notFound, unprocessable } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';
import { inTransaction } from '../lib/transaction.js';
import { isoDateTime, paginationQuery, projectIdParams } from '../lib/validation.js';
import { currentUser } from '../middleware/authenticate.js';

const projectSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  startDate: true,
  dueDate: true,
  ownerId: true,
  owner: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
  _count: { select: { tasks: true } },
} satisfies Prisma.ProjectSelect;

const projectFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable(),
  status: z.enum(ProjectStatus),
  startDate: isoDateTime.nullable(),
  dueDate: isoDateTime.nullable(),
  ownerId: z.uuid(),
};

// Strict objects: unknown keys (id, createdAt, ...) are rejected instead of silently mass-assigned.
const createProjectBody = z.strictObject(projectFields).partial().required({ name: true });
const updateProjectBody = z
  .strictObject(projectFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');
const listProjectsQuery = paginationQuery.extend({ status: z.enum(ProjectStatus).optional() });

async function findProjectOrThrow(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: projectSelect });
  if (!project) throw notFound('Project');
  return project;
}

/** Projects are owned by active project managers; the foreign key alone can't check the role. */
async function assertProjectManager(userId: string): Promise<void> {
  const pm = await prisma.user.findFirst({
    where: { id: userId, role: Role.PROJECT_MANAGER, isActive: true },
    select: { id: true },
  });
  if (!pm) throw unprocessable('ownerId must reference an active project manager');
}

/** GET /api/projects: admins see all projects, PMs only their own. */
export async function listProjects(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { status, limit, offset } = listProjectsQuery.parse(req.query);
  const projects = await prisma.project.findMany({
    where: { AND: [projectScope(user), { status }] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    skip: offset,
    select: projectSelect,
  });
  res.json({ data: projects, limit, offset });
}

/** GET /api/projects/:projectId */
export async function getProject(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { projectId } = projectIdParams.parse(req.params);
  const project = await findProjectOrThrow(projectId);
  // Checked against the owner id stored in the database, never against anything the client sent.
  if (!canManageProject(user, project)) throw forbidden('You can only access your own projects');
  res.json(project);
}

/** POST /api/projects: a PM always creates projects they own; an admin must name the owning PM. */
export async function createProject(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { ownerId: requestedOwnerId, ...fields } = createProjectBody.parse(req.body);

  let ownerId: string;
  if (user.role === Role.ADMIN) {
    if (!requestedOwnerId) throw unprocessable('ownerId is required: projects are owned by a project manager');
    await assertProjectManager(requestedOwnerId);
    ownerId = requestedOwnerId;
  } else if (user.role === Role.PROJECT_MANAGER) {
    if (requestedOwnerId && requestedOwnerId !== user.id) {
      throw forbidden('Project managers can only create projects they own');
    }
    ownerId = user.id;
  } else {
    throw forbidden('Only admins and project managers can create projects');
  }

  const project = await inTransaction(async (ctx) => {
    const created = await ctx.tx.project.create({ data: { ...fields, ownerId }, select: projectSelect });
    await logAndEmitProjectActivity(created.id, user.id, projectActions.created(created.name), ctx);
    return created;
  });
  res.status(201).location(`/api/projects/${project.id}`).json(project);
}

/** PATCH /api/projects/:projectId: owner PM or admin; only an admin can transfer ownership. */
export async function updateProject(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { projectId } = projectIdParams.parse(req.params);
  const project = await findProjectOrThrow(projectId);
  if (!canManageProject(user, project)) throw forbidden('You can only modify your own projects');

  const changes = updateProjectBody.parse(req.body);
  if (changes.ownerId !== undefined && changes.ownerId !== project.ownerId) {
    if (user.role !== Role.ADMIN) throw forbidden('Only an admin can transfer project ownership');
    await assertProjectManager(changes.ownerId);
  }

  const updated = await inTransaction(async (ctx) => {
    const row = await ctx.tx.project.update({
      // Ownership is re-asserted in the write itself: if the project changed hands after the check
      // above, nothing matches and the request fails instead of writing.
      where: { id: project.id, AND: [projectScope(user)] },
      data: changes,
      select: projectSelect,
    });
    for (const change of fieldChanges(project, changes, ['description'])) {
      await logAndEmitProjectActivity(project.id, user.id, projectActions.updated(row.name, change), ctx);
    }
    return row;
  });
  res.json(updated);
}

/** DELETE /api/projects/:projectId: owner PM or admin. Tasks cascade; activity history is kept. */
export async function deleteProject(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { projectId } = projectIdParams.parse(req.params);
  const project = await findProjectOrThrow(projectId);
  if (!canManageProject(user, project)) throw forbidden('You can only delete your own projects');

  await inTransaction(async (ctx) => {
    // Logged first, while the project (and so its recipients) still exists. ON DELETE SET NULL then
    // clears project_id, so the name survives in the message and metadata.
    await logAndEmitProjectActivity(project.id, user.id, projectActions.deleted(project.name), ctx);
    await ctx.tx.project.delete({ where: { id: project.id, AND: [projectScope(user)] } });
  });
  res.status(204).end();
}
