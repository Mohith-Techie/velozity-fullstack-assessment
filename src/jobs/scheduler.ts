import cron from 'node-cron';
import { env } from '../config/env.js';
import { runOverdueSweep } from './overdueTasks.js';

let inFlight: Promise<void> | undefined;

/** One sweep at a time per process (cron ticks and the startup run share this guard). */
function sweepOverdueTasks(): Promise<void> {
  inFlight ??= (async () => {
    try {
      const { flagged, batches, skipped } = await runOverdueSweep();
      if (skipped) console.info('[overdue-tasks] another instance holds the sweep lock; skipped');
      else if (flagged > 0) console.info(`[overdue-tasks] flagged ${flagged} task(s) as OVERDUE in ${batches} batch(es)`);
    } catch (error) {
      console.error('[overdue-tasks] sweep failed; retrying on the next run', error);
    } finally {
      inFlight = undefined;
    }
  })();
  return inFlight;
}

/** Starts the background jobs and returns a function that stops them (waiting for an in-flight run). */
export function startJobs(): () => Promise<void> {
  const overdueTask = cron.schedule(env.OVERDUE_SWEEP_CRON, sweepOverdueTasks, {
    name: 'overdue-tasks',
    timezone: 'UTC',
    noOverlap: true,
  });
  void sweepOverdueTasks(); // catch up on anything that fell due while the server was down

  return async () => {
    await overdueTask.stop();
    await inFlight;
  };
}
