import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/axios';
import { toApiError, type ApiError } from '../../api/errors';
import { useSocket } from '../../realtime/SocketProvider';
import type { NotificationEvent, NotificationItem, NotificationList, NotificationsReadEvent } from './types';

const LIMIT = 20;

/**
 * The signed-in user's notifications: loaded from the API, then kept current by the shared socket.
 * The unread count always comes from the server (every event carries it), so the badge can't drift.
 * Marking read is optimistic; if the request fails, the list is reloaded from the server.
 */
export function useNotifications() {
  const { socket } = useSocket();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<NotificationList>('/notifications', { params: { limit: LIMIT } });
      setItems(data.data);
      setUnreadCount(data.unreadCount);
      setError(undefined);
    } catch (err) {
      setError(toApiError(err));
    }
  }, []);

  useEffect(() => {
    if (!socket) return;
    void load();

    // Reload after a reconnect, to pick up anything that arrived while offline.
    let connectedBefore = socket.connected;
    const onConnect = () => {
      if (connectedBefore) void load();
      connectedBefore = true;
    };
    const onNotification = ({ notification, unreadCount: count }: NotificationEvent) => {
      setItems((current) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, LIMIT));
      setUnreadCount(count);
    };
    const onRead = ({ ids, unreadCount: count }: NotificationsReadEvent) => {
      setItems((current) => current.map((item) => (ids === 'all' || ids.includes(item.id) ? { ...item, isRead: true } : item)));
      setUnreadCount(count);
    };

    socket.on('connect', onConnect);
    socket.on('notification', onNotification);
    socket.on('notifications_read', onRead);
    return () => {
      socket.off('connect', onConnect);
      socket.off('notification', onNotification);
      socket.off('notifications_read', onRead);
    };
  }, [socket, load]);

  const markRead = async (id: string) => {
    if (items.find((item) => item.id === id)?.isRead !== false) return;
    setItems((current) => current.map((item) => (item.id === id ? { ...item, isRead: true } : item)));
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      const { data } = await api.patch<{ unreadCount: number }>(`/notifications/${id}/read`);
      setUnreadCount(data.unreadCount);
    } catch (err) {
      setError(toApiError(err));
      void load();
    }
  };

  const markAllRead = async () => {
    setItems((current) => current.map((item) => ({ ...item, isRead: true })));
    setUnreadCount(0);
    try {
      const { data } = await api.post<{ unreadCount: number }>('/notifications/read-all');
      setUnreadCount(data.unreadCount);
    } catch (err) {
      setError(toApiError(err));
      void load();
    }
  };

  return { items, unreadCount, error, markRead, markAllRead };
}
