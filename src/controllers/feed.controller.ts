import type { Request, Response } from 'express';
import { z } from 'zod';
import { activityFeedSelect } from '../activity/logAndEmitActivity.js';
import { activityScope } from '../auth/policies.js';
import { prisma } from '../lib/prisma.js';
import { isoDateTime } from '../lib/validation.js';
import { currentUser } from '../middleware/authenticate.js';

const CATCHUP_LIMIT = 20;

const catchupQuery = z.object({
  /** Optional: only events after this moment, e.g. the createdAt of the last event the client saw. */
  since: isoDateTime.optional(),
});

/**
 * GET /api/feed/catchup: the 20 most recent events the caller is allowed to see, newest first, so a
 * client coming back online can fill the gap. Same visibility as the live rooms: admins see everything,
 * PMs their own projects, developers the tasks assigned to them.
 */
export async function catchup(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { since } = catchupQuery.parse(req.query);
  const events = await prisma.activityLog.findMany({
    where: { AND: [activityScope(user), since ? { createdAt: { gt: since } } : {}] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: CATCHUP_LIMIT,
    select: activityFeedSelect,
  });
  res.json({ data: events });
}
