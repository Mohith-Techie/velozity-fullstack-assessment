import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { refreshAccessToken } from '../api/axios';
import { useAuthStore } from '../features/auth/authStore';

export type ConnectionStatus = 'connecting' | 'live' | 'offline';

interface SocketState {
  socket: Socket | null;
  status: ConnectionStatus;
}

/**
 * Where the socket connects. Unset (development): same origin, where Vite proxies /socket.io to the local API.
 * Production: the Render backend directly (VITE_SOCKET_URL in web/.env.production), because Vercel rewrites
 * can't proxy WebSockets. No cookie is involved: the socket authenticates with the access token.
 */
const SOCKET_URL: string | undefined = import.meta.env.VITE_SOCKET_URL || undefined;

const SocketContext = createContext<SocketState>({ socket: null, status: 'connecting' });

/**
 * One Socket.IO connection per signed-in tab, shared by every real-time feature (activity feed, notifications).
 * The access token goes in the handshake `auth` payload and is re-read on every (re)connect. When the server
 * drops the socket because the token expired, the provider refreshes it (the same single-flight refresh the
 * Axios interceptor uses) and reconnects. If the refresh fails, the user is logged out.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const userId = useAuthStore((state) => state.user?.id);
  const [state, setState] = useState<SocketState>({ socket: null, status: 'connecting' });

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let reauthAttempted = false;

    const socket = io(SOCKET_URL, {
      auth: (send) => send({ token: useAuthStore.getState().accessToken }),
      transports: ['websocket'],
    });

    const setStatus = (status: ConnectionStatus) => {
      if (active) setState({ socket, status });
    };

    const reauthenticate = async () => {
      try {
        await refreshAccessToken();
        if (active) socket.connect();
      } catch {
        // Refresh failed: the session is cleared, and this provider unmounts with it.
      }
    };

    socket.on('connect', () => {
      reauthAttempted = false;
      setStatus('live');
    });
    socket.on('disconnect', () => setStatus('offline'));
    // Sent right before the server drops a socket whose access token expired.
    socket.on('session_expired', () => void reauthenticate());
    socket.on('connect_error', () => {
      setStatus('offline');
      // `active` is false when the server rejected the handshake (e.g. expired token): Socket.IO won't retry
      // that on its own. Refresh once and reconnect. Network errors keep retrying automatically.
      if (!socket.active && !reauthAttempted) {
        reauthAttempted = true;
        void reauthenticate();
      }
    });
    setState({ socket, status: 'connecting' });

    return () => {
      active = false;
      socket.disconnect();
      setState({ socket: null, status: 'connecting' });
    };
  }, [userId]);

  return <SocketContext.Provider value={state}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
