import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { CookieOptions, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { authUserSelect, type AuthUser } from "./authUser.js";

const ISSUER = "pm-dashboard-api";
const AUDIENCE = "pm-dashboard";

// ─── Access tokens: short-lived JWTs sent as `Authorization: Bearer <token>` ──

/**
 * The token only identifies the user (`sub`). Role and account status are re-read from the database on
 * every request, so demoting or deactivating a user takes effect immediately rather than at token expiry.
 */
export function signAccessToken(userId: string): string {
  return jwt.sign({}, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

/** Throws jsonwebtoken's TokenExpiredError / JsonWebTokenError on any failure. `expiresAt` is epoch ms. */
export function verifyAccessToken(token: string): {
  userId: string;
  expiresAt: number;
} {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ["HS256"], // pinned: the token's own header never gets to choose the algorithm
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  // jsonwebtoken accepts tokens without `exp` (they would never expire), so insist on it.
  if (
    typeof payload === "string" ||
    !payload.sub ||
    typeof payload.exp !== "number"
  ) {
    throw new jwt.JsonWebTokenError("Token is missing sub or exp");
  }
  return { userId: payload.sub, expiresAt: payload.exp * 1000 };
}

// ─── Refresh tokens: opaque, single-use, stored only as a SHA-256 hash ───────

export const REFRESH_COOKIE = "refresh_token";
const REFRESH_TTL_MS = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * HttpOnly: unreadable from JavaScript, so XSS can't steal it. Secure: only sent over HTTPS.
 * SameSite=Strict: never attached to cross-site requests (CSRF). Path: sent only to /api/auth,
 * not with every API call.
 */
const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "none",
  path: "/api/auth",
};

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...refreshCookieOptions,
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions); // attributes must match or browsers keep the cookie
}

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/**
 * Stores a new refresh token and returns the raw value (only ever sent in the cookie). Tokens from one login
 * share a `familyId`, so a whole session can be revoked at once.
 */
export async function issueRefreshToken(
  userId: string,
  familyId: string = randomUUID(),
  db: Prisma.TransactionClient = prisma,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.refreshToken.create({
    data: {
      tokenHash: hashToken(token),
      familyId,
      userId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return token;
}

export type RefreshResult =
  | { ok: true; user: AuthUser; token: string }
  | { ok: false; reason: "unknown" | "expired" | "reused" | "inactive" };

/**
 * Rotation with reuse detection: each refresh token works exactly once and is replaced by a new one.
 * Presenting a token that was already used means it leaked (or the client raced itself), so the whole
 * token family is revoked and the user has to log in again.
 */
export async function rotateRefreshToken(
  presented: string,
): Promise<RefreshResult> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const current = await tx.refreshToken.findUnique({
      where: { tokenHash: hashToken(presented) },
      select: {
        id: true,
        familyId: true,
        expiresAt: true,
        user: { select: authUserSelect },
      },
    });
    if (!current) return { ok: false, reason: "unknown" };

    // Conditional update = atomic claim: of two concurrent refreshes with the same token, only one gets count 1.
    const { count } = await tx.refreshToken.updateMany({
      where: { id: current.id, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    if (count === 0) {
      if (current.expiresAt <= now) return { ok: false, reason: "expired" };
      await tx.refreshToken.updateMany({
        where: { familyId: current.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      return { ok: false, reason: "reused" };
    }
    if (!current.user.isActive) return { ok: false, reason: "inactive" };

    const token = await issueRefreshToken(
      current.user.id,
      current.familyId,
      tx,
    );
    return { ok: true, user: current.user, token };
  });
}

/** Logout ends the whole session (token family), not just the current token. Unknown tokens are ignored. */
export async function revokeRefreshTokenFamily(
  presented: string,
): Promise<void> {
  const current = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(presented) },
    select: { familyId: true },
  });
  if (!current) return;
  await prisma.refreshToken.updateMany({
    where: { familyId: current.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
