// Shared plumbing for the integration tests. They run the real app against the database in DATABASE_URL,
// which is re-seeded first (exactly like `npm run db:seed`), so never point them at a database you care
// about. Test files share that database, which is why `npm test` runs them one at a time.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { attachSocketServer } from '../src/realtime/socket.js';

export const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Password123!';
export let baseUrl = '';

/** Re-seeds the database, starts the API + Socket.IO on a random port, and returns a stop function. */
export async function startTestServer(): Promise<() => Promise<void>> {
  execFileSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], { stdio: 'pipe' });
  const httpServer = createServer(createApp());
  const io = attachSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  return async () => {
    await new Promise<void>((resolve) => void io.close(() => resolve())); // also closes the HTTP server
    await prisma.$disconnect();
  };
}

export interface ApiResponse {
  status: number;
  body: any;
  headers: Headers;
}

export async function api(
  method: string,
  path: string,
  options: { token?: string | undefined; cookie?: string; body?: unknown } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

export const refreshSetCookie = (res: ApiResponse) =>
  res.headers.getSetCookie().find((c) => c.startsWith('refresh_token='));
export const cookiePair = (setCookie: string | undefined) => setCookie?.split(';')[0] ?? '';

export async function login(email: string) {
  const res = await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return {
    token: res.body.accessToken as string,
    userId: res.body.user.id as string,
    cookie: cookiePair(refreshSetCookie(res)),
  };
}
export type Session = Awaited<ReturnType<typeof login>>;

export const taskIdByTitle = async (title: string) =>
  (await prisma.task.findFirstOrThrow({ where: { title }, select: { id: true } })).id;
export const projectIdByName = async (name: string) =>
  (await prisma.project.findFirstOrThrow({ where: { name }, select: { id: true } })).id;
export const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
