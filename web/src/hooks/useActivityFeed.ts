import { useEffect, useRef, useState } from 'react';
import { api } from '../api/axios';
import type { ActivityEvent } from '../features/activity/types';
import { useSocket, type ConnectionStatus } from '../realtime/SocketProvider';

const MAX_EVENTS = 100;

export type FeedConnection = ConnectionStatus;

const newestFirst = (a: ActivityEvent, b: ActivityEvent) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/** Merges a batch of events into the feed: de-duplicated by id, newest first, capped at MAX_EVENTS. */
function mergeEvents(current: ActivityEvent[], incoming: ActivityEvent[]): ActivityEvent[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort(newestFirst).slice(0, MAX_EVENTS);
}

/**
 * The signed-in user's live activity feed, on the shared socket from SocketProvider. The server decides what
 * each user may see (their socket's role room; catch-up uses the same rules), so this hook only merges:
 *  - on mount, and after every reconnect, GET /api/feed/catchup fills in whatever was missed;
 *  - live `activity` events are prepended as they arrive (duplicates from the catch-up race are dropped).
 */
export function useActivityFeed(): { events: ActivityEvent[]; connection: FeedConnection } {
  const { socket, status } = useSocket();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const newestSeen = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!socket) return;
    let active = true;
    setEvents([]);
    newestSeen.current = undefined;

    const remember = (incoming: ActivityEvent[]) => {
      for (const event of incoming) {
        if (!newestSeen.current || event.createdAt > newestSeen.current) newestSeen.current = event.createdAt;
      }
    };

    const catchUp = async () => {
      try {
        const since = newestSeen.current;
        const { data } = await api.get<{ data: ActivityEvent[] }>('/feed/catchup', { params: since ? { since } : {} });
        if (!active) return;
        remember(data.data);
        setEvents((current) => mergeEvents(current, data.data));
      } catch {
        // Offline, or the session ended (the interceptor already logged the user out). The next reconnect retries.
      }
    };

    const onActivity = (event: ActivityEvent) => {
      remember([event]);
      setEvents((current) =>
        current.some((existing) => existing.id === event.id) ? current : [event, ...current].slice(0, MAX_EVENTS),
      );
    };
    // If the shared socket is already up, every later `connect` is a reconnect; otherwise skip the first one,
    // because the catch-up below already covers it.
    let connectedBefore = socket.connected;
    const onConnect = () => {
      if (connectedBefore) void catchUp(); // fill the gap left by the disconnect
      connectedBefore = true;
    };

    socket.on('activity', onActivity);
    socket.on('connect', onConnect);
    void catchUp(); // whatever happened while this page was closed

    return () => {
      active = false;
      socket.off('activity', onActivity);
      socket.off('connect', onConnect);
    };
  }, [socket]);

  return { events, connection: status };
}
