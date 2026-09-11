import type { ActivityAction, Prisma, TaskStatus } from '../generated/prisma/client.js';

// Builders for activity entries, shared by the API and the seed so the feed reads the same everywhere.
// Each returns the machine-readable action (+ metadata) and a human-readable message. Messages leave the
// actor out: clients render "<actor name> <message>", or "System <message>" when the actor is null.

export interface ActionMessage {
  action: ActivityAction;
  message: string;
  metadata?: Prisma.InputJsonObject;
}

type JsonScalar = string | number | boolean | null;
export type FieldChange = { field: string; from?: JsonScalar; to?: JsonScalar };

/** 'IN_REVIEW' → 'In Review' */
export const label = (value: string) =>
  value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const toJson = (value: unknown): JsonScalar =>
  value instanceof Date ? value.toISOString() : value === undefined ? null : (value as JsonScalar);

/** One `{ field, from, to }` per field whose value actually changes; `opaque` (free-text) fields omit values. */
export function fieldChanges(
  before: Record<string, unknown>,
  changes: Record<string, unknown>,
  opaque: readonly string[] = [],
): FieldChange[] {
  return Object.entries(changes).flatMap(([field, value]) => {
    if (value === undefined) return [];
    const from = toJson(before[field]);
    const to = toJson(value);
    if (from === to) return [];
    return [opaque.includes(field) ? { field } : { field, from, to }];
  });
}

const FIELD_NAMES: Record<string, string> = { dueDate: 'due date', startDate: 'start date', ownerId: 'owner' };

function describeChange(subject: string, { field, to }: FieldChange): string {
  const name = FIELD_NAMES[field] ?? field;
  if ((field === 'priority' || field === 'status') && typeof to === 'string') {
    return `changed the ${name} of ${subject} to ${label(to)}`;
  }
  return `updated the ${name} of ${subject}`;
}

export const taskActions = {
  created: (title: string): ActionMessage => ({ action: 'TASK_CREATED', message: `created "${title}"` }),

  assigned: (title: string, assignee: { id: string; name: string } | null): ActionMessage => ({
    action: 'TASK_ASSIGNED',
    message: assignee ? `assigned "${title}" to ${assignee.name}` : `unassigned "${title}"`,
    metadata: { assigneeId: assignee?.id ?? null, assigneeName: assignee?.name ?? null },
  }),

  statusChanged: (title: string, from: TaskStatus, to: TaskStatus): ActionMessage => ({
    action: 'TASK_STATUS_CHANGED',
    message: `moved "${title}" from ${label(from)} to ${label(to)}`,
    metadata: { from, to },
  }),

  updated: (title: string, change: FieldChange): ActionMessage => ({
    action: 'TASK_UPDATED',
    message:
      change.field === 'title' ? `renamed "${change.from}" to "${change.to}"` : describeChange(`"${title}"`, change),
    metadata: { ...change },
  }),

  deleted: (title: string): ActionMessage => ({ action: 'TASK_DELETED', message: `deleted "${title}"`, metadata: { title } }),
};

export const projectActions = {
  created: (name: string): ActionMessage => ({ action: 'PROJECT_CREATED', message: `created the project "${name}"` }),

  updated: (name: string, change: FieldChange): ActionMessage => ({
    action: 'PROJECT_UPDATED',
    message:
      change.field === 'name'
        ? `renamed the project "${change.from}" to "${change.to}"`
        : describeChange(`the project "${name}"`, change),
    metadata: { ...change },
  }),

  deleted: (name: string): ActionMessage => ({
    action: 'PROJECT_DELETED',
    message: `deleted the project "${name}"`,
    metadata: { name },
  }),
};
