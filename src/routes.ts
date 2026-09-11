import { Router } from 'express';
import { login, logout, refresh } from './controllers/auth.controller.js';
import { catchup } from './controllers/feed.controller.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './controllers/notifications.controller.js';
import { createProject, deleteProject, getProject, listProjects, updateProject } from './controllers/projects.controller.js';
import { adminSummary, pmSummary } from './controllers/summary.controller.js';
import { adminTaskList, developerTaskList, listTasks, pmTaskList } from './controllers/taskLists.controller.js';
import { createTask, deleteTask, getTask, updateTask } from './controllers/tasks.controller.js';
import { Role } from './generated/prisma/client.js';
import { authenticate } from './middleware/authenticate.js';
import { requireRole } from './middleware/requireRole.js';

// Two layers of RBAC:
//  1. requireRole (below): which roles may call an endpoint at all.
//  2. Controllers: which *rows* the caller may touch, by comparing req.user.id with the owner/assignee
//     ids in the database: PMs only their own projects (and those projects' tasks), developers only
//     the tasks assigned to them. Admins pass both layers for everything.

const { ADMIN, PROJECT_MANAGER, DEVELOPER } = Role;
const MANAGERS = [ADMIN, PROJECT_MANAGER];
const EVERYONE = [ADMIN, PROJECT_MANAGER, DEVELOPER]; // explicit, so a future role gets no access by default

/** Mounted at /api/auth, which must match the refresh cookie's Path. */
export const authRouter = Router();
authRouter.post('/login', login);
authRouter.post('/refresh', refresh); // authenticated by the HttpOnly refresh cookie
authRouter.post('/logout', logout);

/** Mounted at /api/projects. Developers have no project access. */
export const projectRouter = Router();
projectRouter.use(authenticate, requireRole(MANAGERS));
projectRouter.get('/', listProjects); // admin: all · PM: own
projectRouter.post('/', createProject); // PM: owner is always self · admin: must name the owning PM
projectRouter.get('/:projectId', getProject); // admin · owning PM
projectRouter.patch('/:projectId', updateProject); // admin · owning PM (ownership transfer: admin only)
projectRouter.delete('/:projectId', deleteProject); // admin · owning PM
projectRouter.post('/:projectId/tasks', createTask); // admin · owning PM

/** Mounted at /api/tasks. */
export const taskRouter = Router();
taskRouter.use(authenticate);
taskRouter.get('/', requireRole(EVERYONE), listTasks); // admin: all · PM: own projects · dev: assigned
taskRouter.get('/:taskId', requireRole(EVERYONE), getTask); // same rules, per task
taskRouter.patch('/:taskId', requireRole(EVERYONE), updateTask); // dev: own tasks, status only
taskRouter.delete('/:taskId', requireRole(MANAGERS), deleteTask); // admin · owning PM

/** Mounted at /api/feed. Visibility is scoped per role in the controller, with the same rules as the socket rooms. */
export const feedRouter = Router();
feedRouter.use(authenticate);
feedRouter.get('/catchup', requireRole(EVERYONE), catchup); // admin: all · PM: own projects · dev: own tasks

/** Mounted at /api/notifications. Every user reads and marks only their own notifications. */
export const notificationRouter = Router();
notificationRouter.use(authenticate, requireRole(EVERYONE));
notificationRouter.get('/', listNotifications); // newest first + unread count
notificationRouter.post('/read-all', markAllNotificationsRead);
notificationRouter.patch('/:notificationId/read', markNotificationRead);

/** Mounted at /api/dashboard. Each dashboard's endpoints are reachable only by its own role. */
export const dashboardRouter = Router();
dashboardRouter.use(authenticate);
dashboardRouter.get('/admin/summary', requireRole([ADMIN]), adminSummary); // projects, tasks by status, users
dashboardRouter.get('/pm/summary', requireRole([PROJECT_MANAGER]), pmSummary); // own projects, priorities, due soon
dashboardRouter.get('/admin/tasks', requireRole([ADMIN]), adminTaskList); // every task
dashboardRouter.get('/pm/tasks', requireRole([PROJECT_MANAGER]), pmTaskList); // tasks in the PM's projects
dashboardRouter.get('/developer/tasks', requireRole([DEVELOPER]), developerTaskList); // tasks assigned to the dev
