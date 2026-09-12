/**
 * Seed script: wipes the database and loads a realistic, internally consistent dataset.
 *
 *   npm run db:seed        (alias for `prisma db seed`)
 *
 * - Everything is built and validated in memory first, then written in ONE transaction:
 *   the database is either fully re-seeded or left untouched.
 * - All dates are relative to "now", so overdue / due-soon states are correct whenever you run it.
 * - Activity history and notifications are derived from each task's final state, so the feed,
 *   task timestamps (createdAt / updatedAt / completedAt) and inboxes always agree.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { projectActions, taskActions, type ActionMessage } from '../src/activity/actions.js';
import { databaseHost, isLocalDatabase } from '../src/lib/databaseUrl.js';
import {
  PrismaClient,
  type NotificationType,
  type Prisma,
  type Priority,
  type TaskStatus,
} from '../src/generated/prisma/client.js';

const { DATABASE_URL, NODE_ENV, SEED_ALLOW_REMOTE, SEED_USER_PASSWORD } = process.env;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and point it at your database.');
}
// This script wipes every table, and the test suite runs it too. Only a local database may be wiped by
// default, so a .env that points at the hosted database can never be reset by accident.
if ((NODE_ENV === 'production' || !isLocalDatabase(DATABASE_URL)) && SEED_ALLOW_REMOTE !== 'true') {
  throw new Error(
    `Refusing to wipe the database at "${databaseHost(DATABASE_URL) || 'an unparseable URL'}". ` +
      'Seed a local database, or set SEED_ALLOW_REMOTE=true to reset this one on purpose.',
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

const SALT_ROUNDS = 10;
const PASSWORD = SEED_USER_PASSWORD ?? 'Password123!';

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ─── Static data ─────────────────────────────────────────────────────────────

const USERS = {
  admin: { name: 'Alex Morgan', email: 'admin@example.com', role: 'ADMIN' },
  priya: { name: 'Priya Sharma', email: 'priya.sharma@example.com', role: 'PROJECT_MANAGER' },
  marcus: { name: 'Marcus Chen', email: 'marcus.chen@example.com', role: 'PROJECT_MANAGER' },
  sofia: { name: 'Sofia Alvarez', email: 'sofia.alvarez@example.com', role: 'DEVELOPER' },
  daniel: { name: 'Daniel Okafor', email: 'daniel.okafor@example.com', role: 'DEVELOPER' },
  emma: { name: 'Emma Larsen', email: 'emma.larsen@example.com', role: 'DEVELOPER' },
  kenji: { name: 'Kenji Tanaka', email: 'kenji.tanaka@example.com', role: 'DEVELOPER' },
} as const;

type UserKey = keyof typeof USERS;
type KeysWithRole<R extends string> = { [K in UserKey]: (typeof USERS)[K]['role'] extends R ? K : never }[UserKey];
// The compiler rejects a project owned by a non-PM or a task assigned to a non-developer.
type PmKey = KeysWithRole<'PROJECT_MANAGER'>;
type DevKey = KeysWithRole<'DEVELOPER'>;

type OpenStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW';

interface TaskSpec {
  title: string;
  status: TaskStatus;
  priority: Priority;
  assignee?: DevKey;
  createdDaysAgo: number;
  /** Negative = deadline already passed. Omit for no due date. */
  dueInDays?: number;
  /** IN_PROGRESS / IN_REVIEW / DONE: when the latest status change happened (DONE: completion time). */
  movedDaysAgo?: number;
  /** OVERDUE only: the status the task was stuck in when the cron job flagged it. Default IN_PROGRESS. */
  stalledIn?: OpenStatus;
  /** Adds a TASK_UPDATED entry: priority was raised from this value to `priority`. */
  priorityRaisedFrom?: Priority;
}

interface ProjectSpec {
  name: string;
  description: string;
  owner: PmKey;
  createdDaysAgo: number;
  startedDaysAgo: number;
  dueInDays: number;
  tasks: TaskSpec[];
}

const PROJECTS: ProjectSpec[] = [
  {
    name: 'Customer Portal Redesign',
    description: 'Rebuild the self-service portal on the new design system with SSO and faster billing pages.',
    owner: 'priya',
    createdDaysAgo: 42,
    startedDaysAgo: 40,
    dueInDays: 35,
    tasks: [
      { title: 'Design system tokens & component library', status: 'DONE', priority: 'HIGH', assignee: 'sofia', createdDaysAgo: 40, dueInDays: -20, movedDaysAgo: 22 },
      { title: 'Implement SSO login (SAML + OIDC)', status: 'DONE', priority: 'URGENT', priorityRaisedFrom: 'HIGH', assignee: 'daniel', createdDaysAgo: 38, dueInDays: -10, movedDaysAgo: 12 },
      { title: 'Rebuild account settings page', status: 'IN_REVIEW', priority: 'MEDIUM', assignee: 'sofia', createdDaysAgo: 30, dueInDays: 3, movedDaysAgo: 0.2 },
      { title: 'Server-side pagination for invoices view', status: 'IN_PROGRESS', priority: 'HIGH', assignee: 'daniel', createdDaysAgo: 20, dueInDays: 6, movedDaysAgo: 2 },
      { title: 'Accessibility fixes from WCAG 2.2 audit', status: 'OVERDUE', priority: 'HIGH', assignee: 'sofia', createdDaysAgo: 25, dueInDays: -3, stalledIn: 'IN_PROGRESS' },
      { title: 'Dark mode support', status: 'TODO', priority: 'LOW', createdDaysAgo: 3 },
    ],
  },
  {
    name: 'Mobile App v2.0',
    description: 'Offline-first rewrite of the iOS and Android apps with biometric login and push notifications.',
    owner: 'marcus',
    createdDaysAgo: 30,
    startedDaysAgo: 28,
    dueInDays: 45,
    tasks: [
      { title: 'Offline mode with local sync queue', status: 'IN_PROGRESS', priority: 'URGENT', priorityRaisedFrom: 'HIGH', assignee: 'kenji', createdDaysAgo: 26, dueInDays: 9, movedDaysAgo: 4 },
      { title: 'Push notification service integration', status: 'DONE', priority: 'HIGH', assignee: 'emma', createdDaysAgo: 27, dueInDays: -8, movedDaysAgo: 9 },
      { title: 'Biometric login (Face ID / fingerprint)', status: 'IN_REVIEW', priority: 'HIGH', assignee: 'emma', createdDaysAgo: 18, dueInDays: 0.6, movedDaysAgo: 1 },
      { title: 'Crash reporting & ANR monitoring', status: 'OVERDUE', priority: 'MEDIUM', assignee: 'kenji', createdDaysAgo: 20, dueInDays: -2, stalledIn: 'TODO' },
      { title: 'App Store screenshots & release notes', status: 'TODO', priority: 'LOW', assignee: 'emma', createdDaysAgo: 6, dueInDays: 14 },
      { title: 'Deep linking for shared content', status: 'TODO', priority: 'MEDIUM', assignee: 'kenji', createdDaysAgo: 4, dueInDays: 12 },
    ],
  },
  {
    name: 'Payments Service Migration',
    description: 'Move card processing off the legacy monolith onto the new payments service with zero downtime.',
    owner: 'priya',
    createdDaysAgo: 21,
    startedDaysAgo: 19,
    dueInDays: 25,
    tasks: [
      { title: 'Idempotency keys for payment webhooks', status: 'DONE', priority: 'URGENT', assignee: 'daniel', createdDaysAgo: 19, dueInDays: -5, movedDaysAgo: 6 },
      { title: 'Dual-write ledger to the new payments DB', status: 'IN_PROGRESS', priority: 'URGENT', assignee: 'daniel', createdDaysAgo: 15, dueInDays: 2, movedDaysAgo: 0.1 },
      { title: 'Daily reconciliation report for finance', status: 'OVERDUE', priority: 'HIGH', assignee: 'kenji', createdDaysAgo: 16, dueInDays: -1, stalledIn: 'IN_REVIEW' },
      { title: 'PCI scope review & documentation', status: 'IN_REVIEW', priority: 'MEDIUM', assignee: 'sofia', createdDaysAgo: 12, dueInDays: 4, movedDaysAgo: 0.5 },
      { title: 'Retry + dead-letter queue for failed charges', status: 'IN_PROGRESS', priority: 'HIGH', assignee: 'kenji', createdDaysAgo: 10, dueInDays: 0.4, movedDaysAgo: 3 },
      { title: 'Load test checkout at 3x peak traffic', status: 'TODO', priority: 'HIGH', assignee: 'emma', createdDaysAgo: 2, dueInDays: 10 },
    ],
  },
];

// Workflow each final status implies, oldest move first (TODO is the implicit starting point).
const STATUS_PATH: Record<Exclude<TaskStatus, 'OVERDUE'>, TaskStatus[]> = {
  TODO: [],
  IN_PROGRESS: ['IN_PROGRESS'],
  IN_REVIEW: ['IN_PROGRESS', 'IN_REVIEW'],
  DONE: ['IN_PROGRESS', 'IN_REVIEW', 'DONE'],
};

// ─── Dataset builder ─────────────────────────────────────────────────────────

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid seed data: ${message}`);
}

const formatDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format;

function buildDataset() {
  const userIds = Object.fromEntries(Object.keys(USERS).map((key) => [key, randomUUID()])) as Record<UserKey, string>;

  const users: Prisma.UserCreateManyInput[] = Object.entries(USERS).map(([key, user]) => ({
    id: userIds[key as UserKey],
    ...user,
    // Synchronous hashing, one call per user so every hash gets its own random salt.
    passwordHash: bcrypt.hashSync(PASSWORD, SALT_ROUNDS),
    createdAt: new Date(NOW - 60 * DAY),
    updatedAt: new Date(NOW - 60 * DAY),
  }));

  const projects: Prisma.ProjectCreateManyInput[] = [];
  const tasks: Prisma.TaskCreateManyInput[] = [];
  const activity: Prisma.ActivityLogCreateManyInput[] = [];
  const notifications: Prisma.NotificationCreateManyInput[] = [];

  type Refs = { projectId: string; taskId?: string };

  // Same builders as the API, so seeded and live feed entries read identically.
  const log = (at: number, actor: UserKey | null, refs: Refs, { action, message, metadata }: ActionMessage) => {
    assert(at <= NOW, `${action} for ${refs.taskId ?? refs.projectId} is in the future`);
    activity.push({ action, message, metadata, actorId: actor && userIds[actor], ...refs, createdAt: new Date(at) });
  };

  const notify = (at: number, recipient: UserKey, type: NotificationType, message: string, refs: Refs) => {
    assert(at <= NOW, `${type} notification "${message}" is in the future`);
    // Anything older than two days has been seen; recent ones light up the bell icon.
    notifications.push({ type, message, recipientId: userIds[recipient], ...refs, isRead: at < NOW - 2 * DAY, createdAt: new Date(at) });
  };

  for (const p of PROJECTS) {
    assert(p.tasks.length >= 5, `project "${p.name}" needs at least 5 tasks`);
    const projectId = randomUUID();
    const pm = p.owner;
    const projectCreatedAt = NOW - p.createdDaysAgo * DAY;
    const startedAt = NOW - p.startedDaysAgo * DAY;

    projects.push({
      id: projectId,
      name: p.name,
      description: p.description,
      status: 'ACTIVE',
      ownerId: userIds[pm],
      startDate: new Date(startedAt),
      dueDate: new Date(NOW + p.dueInDays * DAY),
      createdAt: new Date(projectCreatedAt),
      updatedAt: new Date(startedAt),
    });
    log(projectCreatedAt, pm, { projectId }, projectActions.created(p.name));
    log(startedAt, pm, { projectId }, projectActions.updated(p.name, { field: 'status', from: 'PLANNING', to: 'ACTIVE' }));

    for (const t of p.tasks) {
      const taskId = randomUUID();
      const refs = { projectId, taskId };
      const dev = t.assignee;
      const createdAt = NOW - t.createdDaysAgo * DAY;
      const assignedAt = createdAt + HOUR;
      const dueAt = t.dueInDays === undefined ? undefined : NOW + t.dueInDays * DAY;
      const where = `task "${t.title}"`;
      assert(createdAt >= projectCreatedAt, `${where} was created before its project`);

      // Moves the task went through (oldest first) and when the last one happened.
      let moves: TaskStatus[];
      let lastMoveAt: number;
      if (t.status === 'OVERDUE') {
        assert(dueAt !== undefined && dueAt < NOW - 5 * MINUTE, `${where} is OVERDUE but its due date is not in the past`);
        moves = STATUS_PATH[t.stalledIn ?? 'IN_PROGRESS'];
        lastMoveAt = (assignedAt + dueAt) / 2; // stalled halfway to the deadline
      } else {
        moves = STATUS_PATH[t.status];
        lastMoveAt = t.movedDaysAgo === undefined ? NOW : NOW - t.movedDaysAgo * DAY;
        if (t.status !== 'DONE' && dueAt !== undefined) {
          assert(dueAt > NOW, `${where} is ${t.status} with a past due date; it should be OVERDUE`);
        }
      }
      if (moves.length > 0) {
        assert(dev, `${where} is ${t.status} but has no assignee`);
        assert(lastMoveAt > assignedAt, `${where} moved before it was assigned (check movedDaysAgo)`);
      }

      const eventTimes = [createdAt];
      const taskLog = (at: number, actor: UserKey | null, entry: ActionMessage) => {
        log(at, actor, refs, entry);
        eventTimes.push(at);
      };

      taskLog(createdAt, pm, taskActions.created(t.title));
      if (dev) {
        taskLog(assignedAt, pm, taskActions.assigned(t.title, { id: userIds[dev], name: USERS[dev].name }));
        notify(assignedAt, dev, 'TASK_ASSIGNED', `${USERS[pm].name} assigned you "${t.title}"`, refs);
      }

      // Status moves are spread evenly between assignment and the last move.
      const step = moves.length > 0 ? (lastMoveAt - assignedAt) / moves.length : 0;

      if (t.priorityRaisedFrom) {
        const nextEventAt = moves.length > 0 ? assignedAt + step : Math.min(dueAt ?? NOW, NOW);
        taskLog(
          (assignedAt + nextEventAt) / 2,
          pm,
          taskActions.updated(t.title, { field: 'priority', from: t.priorityRaisedFrom, to: t.priority }),
        );
      }

      let previous: TaskStatus = 'TODO';
      for (const [i, next] of moves.entries()) {
        assert(dev, `${where} has status changes but no assignee`);
        const at = assignedAt + step * (i + 1);
        // Developers move their own work forward; the PM approves it into DONE.
        taskLog(at, next === 'DONE' ? pm : dev, taskActions.statusChanged(t.title, previous, next));
        if (next === 'IN_REVIEW') notify(at, pm, 'TASK_STATUS_CHANGED', `${USERS[dev].name} moved "${t.title}" to review`, refs);
        if (next === 'DONE') notify(at, dev, 'TASK_STATUS_CHANGED', `${USERS[pm].name} approved "${t.title}"`, refs);
        previous = next;
      }

      if (t.status === 'OVERDUE' && dueAt !== undefined) {
        const at = dueAt + 5 * MINUTE; // picked up by the next cron run
        taskLog(at, null, taskActions.statusChanged(t.title, previous, 'OVERDUE'));
        const message = `"${t.title}" is overdue (was due ${formatDay(dueAt)})`;
        for (const recipient of new Set<UserKey>([...(dev ? [dev] : []), pm, 'admin'])) {
          notify(at, recipient, 'TASK_OVERDUE', message, refs);
        }
      } else if (t.status !== 'DONE' && dev && dueAt !== undefined && dueAt - NOW < DAY) {
        notify(dueAt - DAY, dev, 'TASK_DUE_SOON', `"${t.title}" is due within 24 hours`, refs);
      }

      tasks.push({
        id: taskId,
        projectId,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assigneeId: dev ? userIds[dev] : null,
        createdById: userIds[pm],
        dueDate: dueAt === undefined ? null : new Date(dueAt),
        completedAt: t.status === 'DONE' ? new Date(lastMoveAt) : null,
        createdAt: new Date(createdAt),
        updatedAt: new Date(Math.max(...eventTimes)),
      });
    }
  }

  assert(tasks.some((t) => t.status === 'OVERDUE'), 'expected at least one OVERDUE task');
  return { users, projects, tasks, activity, notifications };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = performance.now();
  const data = buildDataset(); // bcrypt runs here, before the transaction opens

  // Children first so foreign keys are never violated mid-way; one transaction for all of it.
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.activityLog.deleteMany(),
    prisma.task.deleteMany(),
    prisma.project.deleteMany(),
    prisma.user.deleteMany(),
    prisma.user.createMany({ data: data.users }),
    prisma.project.createMany({ data: data.projects }),
    prisma.task.createMany({ data: data.tasks }),
    prisma.activityLog.createMany({ data: data.activity }),
    prisma.notification.createMany({ data: data.notifications }),
  ], { maxWait: 15000, timeout: 30000 });

  const overdue = data.tasks.filter((t) => t.status === 'OVERDUE').length;
  console.log(`Seeded in ${Math.round(performance.now() - startedAt)} ms:`);
  console.log(
    `  ${data.users.length} users, ${data.projects.length} projects, ${data.tasks.length} tasks (${overdue} overdue), ` +
      `${data.activity.length} activity entries, ${data.notifications.length} notifications`,
  );
  console.table(Object.values(USERS).map(({ email, role }) => ({ email, role })));
  console.log(`Password for every user: ${SEED_USER_PASSWORD ? '(value of SEED_USER_PASSWORD)' : PASSWORD}`);
}

try {
  await main();
} catch (error) {
  console.error('Seed failed:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
