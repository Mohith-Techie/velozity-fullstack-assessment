import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { BreakdownBars } from '../../components/BreakdownBars';
import { SkeletonBlock, StatCard } from '../../components/StatCard';
import { useApi } from '../../hooks/useApi';
import { STATUS_LABEL, TASK_STATUSES, type TaskStatus } from '../tasks/types';
import type { AdminSummary } from './types';

const STATUS_BAR: Record<TaskStatus, string> = {
  TODO: 'bg-slate-400',
  IN_PROGRESS: 'bg-blue-500',
  IN_REVIEW: 'bg-violet-500',
  DONE: 'bg-emerald-500',
  OVERDUE: 'bg-red-500',
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Workspace-wide numbers: projects, tasks by status, overdue count and active users. */
export function AdminSummaryCards() {
  const { data, error, reload } = useApi<AdminSummary>('/dashboard/admin/summary');

  if (error) return <ApiErrorAlert error={error} onRetry={reload} />;
  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <SkeletonBlock key={index} className="h-28" />
        ))}
      </div>
    );
  }

  const { projects, tasks, activeUsers } = data;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Projects" value={projects.total} />
        <StatCard label="Tasks" value={tasks.total} hint={`${tasks.byStatus.DONE} done`} />
        <StatCard label="Overdue tasks" value={tasks.overdue} tone={tasks.overdue > 0 ? 'danger' : 'default'} />
        <StatCard
          label="Active users"
          value={activeUsers.total}
          hint={[
            plural(activeUsers.byRole.PROJECT_MANAGER, 'PM'),
            plural(activeUsers.byRole.DEVELOPER, 'developer'),
            plural(activeUsers.byRole.ADMIN, 'admin'),
          ].join(' · ')}
        />
      </div>
      <BreakdownBars
        title="Tasks by status"
        order={TASK_STATUSES}
        counts={tasks.byStatus}
        labels={STATUS_LABEL}
        barClass={STATUS_BAR}
      />
    </div>
  );
}
