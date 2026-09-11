import type { RequestHandler } from 'express';
import type { Role } from '../generated/prisma/client.js';
import { forbidden, unauthorized } from '../lib/httpError.js';

/**
 * Route-level gate: "may this role call this endpoint at all?". Must run after `authenticate`.
 * Row-level ownership ("is this *your* project/task?") is enforced separately, in the controllers,
 * against owner/assignee ids read from the database.
 */
export function requireRole(allowedRoles: readonly Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!allowedRoles.includes(req.user.role)) {
      return next(forbidden(`This action requires one of these roles: ${allowedRoles.join(', ')}`));
    }
    next();
  };
}
