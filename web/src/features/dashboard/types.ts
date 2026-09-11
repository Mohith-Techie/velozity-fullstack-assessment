import type { Role } from '../auth/authStore';
import type { Priority, Task, TaskStatus } from '../tasks/types';

/** GET /api/dashboard/admin/summary */
export interface AdminSummary {
  projects: { total: number };
  tasks: { total: number; overdue: number; byStatus: Record<TaskStatus, number> };
  activeUsers: { total: number; byRole: Record<Role, number> };
}

/** GET /api/dashboard/pm/summary */
export interface PmSummary {
  projects: {
    id: string;
    name: string;
    status: string;
    dueDate: string | null;
    tasks: { total: number; done: number; overdue: number };
  }[];
  openTasksByPriority: Record<Priority, number>;
  upcoming: { withinDays: number; tasks: Task[] };
}
