export type ActivityAction =
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'PROJECT_DELETED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_ASSIGNED'
  | 'TASK_STATUS_CHANGED'
  | 'TASK_DELETED';

/** One feed item, as sent by the `activity` socket event and by GET /api/feed/catchup. */
export interface ActivityEvent {
  id: string;
  action: ActivityAction;
  /** Readable summary without the actor, e.g. `moved "Fix login" from In Progress to In Review`. */
  message: string;
  metadata: Record<string, unknown> | null;
  /** ISO-8601 UTC timestamp. */
  createdAt: string;
  /** null = the system (e.g. the overdue job). */
  actor: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  task: { id: string; title: string } | null;
}
