import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { ActivityEvent } from '../activity/logAndEmitActivity.js';
import type { AuthUser } from '../auth/authUser.js';
import { Role } from '../generated/prisma/client.js';
import { HttpError } from '../lib/httpError.js';
import { authenticateAccessToken } from '../middleware/authenticate.js';
import type { NotificationEvent } from '../notifications/notify.js';

export interface NotificationsReadEvent {
  ids: string[] | 'all';
  unreadCount: number;
}

export interface ServerToClientEvents {
  activity: (event: ActivityEvent) => void;
  /** A new notification for this user, sent to their personal room only. */
  notification: (event: NotificationEvent) => void;
  /** Notifications were marked read (possibly in another tab of the same user). */
  notifications_read: (event: NotificationsReadEvent) => void;
  /** Sent just before the server drops a socket whose access token expired: refresh it, then reconnect. */
  session_expired: () => void;
}
/** Clients only listen. No client-to-server events are handled, so clients can't join rooms or push data. */
type ClientToServerEvents = Record<string, never>;
interface SocketData {
  user: AuthUser;
  tokenExpiresAt: number;
}
type ActivityServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export const ADMIN_ROOM = 'global_admin';
export const pmRoom = (userId: string) => `pm_${userId}`;
export const devRoom = (userId: string) => `dev_${userId}`;
/** Personal room: things meant for one user only, whatever their role (notifications). */
export const userRoom = (userId: string) => `user_${userId}`;

/** The role room each socket joins for the activity feed, from the user's role as stored in the database. */
function roomFor(user: AuthUser): string {
  switch (user.role) {
    case Role.ADMIN:
      return ADMIN_ROOM;
    case Role.PROJECT_MANAGER:
      return pmRoom(user.id);
    case Role.DEVELOPER:
      return devRoom(user.id);
  }
}

const MAX_TIMEOUT_MS = 2 ** 31 - 1; // setTimeout's ceiling (~24.8 days)

let io: ActivityServer | undefined;

export function attachSocketServer(httpServer: HttpServer): ActivityServer {
  const server: ActivityServer = new Server(httpServer, {
    serveClient: false,
    maxHttpBufferSize: 16 * 1024, // clients never send anything large
    // WebSocket only: HTTP long-polling is disabled, so no connection can fall back to polling.
    transports: ['websocket'],
  });

  // Handshake authentication, before a socket can join anything. The access token comes in the connect
  // payload (`io(url, { auth: { token } })`), not the URL (which ends up in logs). No cookies are involved,
  // so another site can't open a socket riding the user's session (cross-site WebSocket hijacking).
  server.use(async (socket, next) => {
    try {
      const token: unknown = socket.handshake.auth?.token;
      const { user, expiresAt } = await authenticateAccessToken(typeof token === 'string' ? token : undefined);
      socket.data.user = user;
      socket.data.tokenExpiresAt = expiresAt;
      next();
    } catch (error) {
      next(toConnectError(error));
    }
  });

  server.on('connection', (socket) => {
    const { user, tokenExpiresAt } = socket.data;
    void socket.join([roomFor(user), userRoom(user.id)]);

    // The token is only checked at connect time, so drop the socket when it expires: a deactivated or
    // demoted user stops receiving events within one token lifetime. The client refreshes and reconnects.
    const expiry = setTimeout(
      () => {
        socket.emit('session_expired');
        socket.disconnect(true);
      },
      Math.min(Math.max(tokenExpiresAt - Date.now(), 0), MAX_TIMEOUT_MS),
    );
    socket.on('disconnect', () => clearTimeout(expiry));
  });

  io = server;
  return server;
}

/**
 * Emits to the given rooms only; a socket in several of them receives the event once.
 * No-op when no socket server is attached (seed, cron jobs, scripts).
 */
export function emitToRooms(rooms: readonly string[], event: ActivityEvent): void {
  io?.to([...rooms]).emit('activity', event);
}

/** A new notification, to the recipient's personal room only (all of their tabs, nobody else). */
export function emitNotification(userId: string, event: NotificationEvent): void {
  io?.to(userRoom(userId)).emit('notification', event);
}

export function emitNotificationsRead(userId: string, event: NotificationsReadEvent): void {
  io?.to(userRoom(userId)).emit('notifications_read', event);
}

/** Socket.IO passes this to the client's `connect_error` listener as `err.message` and `err.data`. */
function toConnectError(error: unknown): Error & { data: { code: string } } {
  if (!(error instanceof HttpError)) console.error('Socket authentication failed unexpectedly', error);
  const connectError = new Error(error instanceof HttpError ? error.message : 'Authentication failed');
  return Object.assign(connectError, { data: { code: error instanceof HttpError ? error.code : 'UNAUTHORIZED' } });
}
