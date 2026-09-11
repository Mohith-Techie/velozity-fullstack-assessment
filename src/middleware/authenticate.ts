import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authUserSelect, type AuthUser } from '../auth/authUser.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { unauthorized } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';

/**
 * Verifies an access token, then loads its user from the database. Nothing in the token besides the user
 * id is trusted: a deactivated or demoted user is rejected on their very next request. Shared by the HTTP
 * middleware below and the Socket.IO handshake. Throws a 401 HttpError.
 */
export async function authenticateAccessToken(
  token: string | undefined,
): Promise<{ user: AuthUser; expiresAt: number }> {
  if (!token) throw unauthorized('Missing access token');

  let claims: { userId: string; expiresAt: number };
  try {
    claims = verifyAccessToken(token);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw unauthorized('Access token expired', 'TOKEN_EXPIRED');
    throw unauthorized('Invalid access token', 'INVALID_TOKEN');
  }

  const user = z.uuid().safeParse(claims.userId).success
    ? await prisma.user.findUnique({ where: { id: claims.userId }, select: authUserSelect })
    : null;
  if (!user?.isActive) throw unauthorized('Account not found or deactivated', 'INVALID_TOKEN');
  return { user, expiresAt: claims.expiresAt };
}

/** HTTP middleware: `Authorization: Bearer <access token>` → `req.user`. */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  req.user = (await authenticateAccessToken(token)).user;
  next();
}

/** The authenticated user. Fails closed (401) if a route was mounted without `authenticate`. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
