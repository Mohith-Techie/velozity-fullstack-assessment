export type NotificationType = 'TASK_ASSIGNED' | 'TASK_STATUS_CHANGED' | 'TASK_DUE_SOON' | 'TASK_OVERDUE' | 'PROJECT_UPDATED';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  message: string;
  isRead: boolean;
  /** ISO-8601 UTC timestamp. */
  createdAt: string;
  project: { id: string; name: string } | null;
  task: { id: string; title: string } | null;
}

/** GET /api/notifications */
export interface NotificationList {
  data: NotificationItem[];
  unreadCount: number;
}

/** Socket `notification`: sent only to the recipient's personal room. */
export interface NotificationEvent {
  notification: NotificationItem;
  unreadCount: number;
}

/** Socket `notifications_read`: the user marked notifications read, possibly in another tab. */
export interface NotificationsReadEvent {
  ids: string[] | 'all';
  unreadCount: number;
}
