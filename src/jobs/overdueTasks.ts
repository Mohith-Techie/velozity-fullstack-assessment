import { setTimeout as sleep } from 'node:timers/promises';
import { taskActions } from '../activity/actions.js';
import { logAndEmitActivity } from '../activity/logAndEmitActivity.js';
import type { TaskStatus } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import { inTransaction } from '../lib/transaction.js';

/** "Not DONE or OVERDUE": the statuses the sweep moves to OVERDUE once the due date has passed. */
const OPEN_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW'] as const satisfies readonly TaskStatus[];

/** App-wide key for pg_try_advisory_xact_lock, so only one API instance sweeps at a time. */
const SWEEP_LOCK_KEY = 7_231_001;

export interface SweepOptions {
  /** Deadline cut-off; fixed for the whole run. */
  now?: Date;
  /** Tasks per transaction. */
  batchSize?: number;
  /** Pause between batches, leaving the database room for request traffic. */
  pauseMs?: number;
}

export interface SweepResult {
  flagged: number;
  batches: number;
  /** True when another instance held the sweep lock, so this run did nothing. */
  skipped: boolean;
}

/**
 * Flags every open task whose due date has passed as OVERDUE, logging and broadcasting each change through
 * logAndEmitActivity (actor = system). Built so hundreds of overdue tasks never become one huge transaction:
 *  - candidates are read through the tasks(status, due_date) index, keyset-paginated by id;
 *  - each batch is one short transaction: one bulk UPDATE per previous status (so the log can say
 *    "from In Progress"), repeating the WHERE so a task someone changed in the meantime is skipped;
 *  - socket events go out after each batch commits, and batches are spaced out by `pauseMs`.
 */
export async function runOverdueSweep({
  now = new Date(),
  batchSize = 100,
  pauseMs = 50,
}: SweepOptions = {}): Promise<SweepResult> {
  let cursor: string | undefined;
  let flagged = 0;
  let batches = 0;

  for (;;) {
    const candidates = await prisma.task.findMany({
      where: { status: { in: [...OPEN_STATUSES] }, dueDate: { lt: now }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, status: true },
    });
    const last = candidates.at(-1);
    if (!last) break;
    cursor = last.id;

    const flaggedInBatch = await inTransaction(async (ctx) => {
      const [lock] = await ctx.tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${SWEEP_LOCK_KEY}::bigint) AS locked`;
      if (!lock?.locked) return null; // another instance is sweeping right now

      let count = 0;
      for (const status of OPEN_STATUSES) {
        const ids = candidates.filter((task) => task.status === status).map((task) => task.id);
        if (ids.length === 0) continue;
        const updated = await ctx.tx.task.updateManyAndReturn({
          where: { id: { in: ids }, status, dueDate: { lt: now } },
          data: { status: 'OVERDUE' },
          select: { id: true, title: true },
        });
        for (const task of updated) {
          await logAndEmitActivity(task.id, null, taskActions.statusChanged(task.title, status, 'OVERDUE'), ctx);
        }
        count += updated.length;
      }
      return count;
    });

    if (flaggedInBatch === null) return { flagged, batches, skipped: true };
    flagged += flaggedInBatch;
    batches += 1;
    if (candidates.length < batchSize) break;
    await sleep(pauseMs);
  }

  return { flagged, batches, skipped: false };
}
