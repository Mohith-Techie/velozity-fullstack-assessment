import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authUserSelect, toPublicUser, type AuthUser } from '../auth/authUser.js';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  issueRefreshToken,
  revokeRefreshTokenFamily,
  rotateRefreshToken,
  setRefreshCookie,
  signAccessToken,
  type RefreshResult,
} from '../auth/tokens.js';
import { env } from '../config/env.js';
import { HttpError, unauthorized } from '../lib/httpError.js';
import { prisma } from '../lib/prisma.js';

const loginBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(128),
});

// Compared against when the email is unknown, so both paths cost one bcrypt round and response
// timing doesn't reveal which emails have accounts. Same cost factor as real hashes.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);

const REFRESH_FAILURES: Record<Extract<RefreshResult, { ok: false }>['reason'], string> = {
  unknown: 'Invalid refresh token',
  expired: 'Refresh token expired',
  reused: 'Refresh token was already used; the session has been revoked',
  inactive: 'Account has been deactivated',
};

/** The access token goes in the JSON body. The refresh token never does: it only travels in the cookie. */
function sendAccessToken(res: Response, user: AuthUser): void {
  res.set('Cache-Control', 'no-store');
  res.json({
    accessToken: signAccessToken(user.id),
    tokenType: 'Bearer',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    user: toPublicUser(user),
  });
}

function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}

/** POST /api/auth/login */
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = loginBody.parse(req.body);
  const user = await prisma.user.findUnique({
    where: { email },
    select: { ...authUserSelect, passwordHash: true },
  });

  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !passwordMatches) throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  if (!user.isActive) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');

  setRefreshCookie(res, await issueRefreshToken(user.id));
  sendAccessToken(res, user);
}

/** POST /api/auth/refresh: authenticated by the refresh cookie alone; rotates it on every call. */
export async function refresh(req: Request, res: Response): Promise<void> {
  const presented = readRefreshCookie(req);
  if (!presented) throw unauthorized('Missing refresh token', 'INVALID_REFRESH_TOKEN');

  const result = await rotateRefreshToken(presented);
  if (!result.ok) {
    clearRefreshCookie(res);
    throw unauthorized(REFRESH_FAILURES[result.reason], 'INVALID_REFRESH_TOKEN');
  }
  setRefreshCookie(res, result.token);
  sendAccessToken(res, result.user);
}

/** POST /api/auth/logout: works even with an expired access token. Idempotent. */
export async function logout(req: Request, res: Response): Promise<void> {
  const presented = readRefreshCookie(req);
  if (presented) await revokeRefreshTokenFamily(presented);
  clearRefreshCookie(res);
  res.status(204).end();
}
