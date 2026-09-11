import { Role, type Prisma } from '../generated/prisma/client.js';
import { forbidden } from '../lib/httpError.js';
import type { AuthUser } from './authUser.js';

// Row-level access rules, applied two ways:
//  - `projectScope` / `taskScope` return a Prisma `where` fragment, so list queries can only return rows
//    the user may see, and writes re-assert ownership in their own WHERE clause;
//  - `canManageProject` / `taskAccess` compare a row's owner/assignee ids (read from the database) with
//    `user.id` before anything is changed.

export function projectScope(user: AuthUser): Prisma.ProjectWhereInput {
  switch (user.role) {
    case Role.ADMIN:
      return {};
    case Role.PROJECT_MANAGER:
      return { ownerId: user.id };
    case Role.DEVELOPER:
      throw forbidden('Developers have no access to projects');
  }
}

export function taskScope(user: AuthUser): Prisma.TaskWhereInput {
  switch (user.role) {
    case Role.ADMIN:
      return {};
    case Role.PROJECT_MANAGER:
      return { project: { ownerId: user.id } };
    case Role.DEVELOPER:
      return { assigneeId: user.id };
  }
}

/** Activity feed visibility, mirroring the socket rooms: admins all, PMs their projects, developers their tasks. */
export function activityScope(user: AuthUser): Prisma.ActivityLogWhereInput {
  switch (user.role) {
    case Role.ADMIN:
      return {};
    case Role.PROJECT_MANAGER:
      return { project: { ownerId: user.id } };
    case Role.DEVELOPER:
      return { task: { assigneeId: user.id } };
  }
}

export function canManageProject(user: AuthUser, project: { ownerId: string }): boolean {
  return user.role === Role.ADMIN || (user.role === Role.PROJECT_MANAGER && project.ownerId === user.id);
}

/**
 * 'manage'   – admin, or the PM who owns the task's project: may change or delete anything.
 * 'assignee' – the developer the task is assigned to: may read it and move its status.
 * null       – no access.
 */
export type TaskAccess = 'manage' | 'assignee' | null;

export function taskAccess(
  user: AuthUser,
  task: { assigneeId: string | null; project: { ownerId: string } },
): TaskAccess {
  if (canManageProject(user, task.project)) return 'manage';
  if (user.role === Role.DEVELOPER && task.assigneeId === user.id) return 'assignee';
  return null;
}
