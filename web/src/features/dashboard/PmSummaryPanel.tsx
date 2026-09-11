import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { PriorityBadge } from '../../components/Badges';
import { BreakdownBars } from '../../components/BreakdownBars';
import { SkeletonBlock } from '../../components/StatCard';
import { useApi } from '../../hooks/useApi';
import { DueDate } from '../tasks/TaskTable';
import { PRIORITIES, PRIORITY_LABEL, type Priority } from '../tasks/types';
import type { PmSummary } from './types';

const PRIORITY_BAR: Record<Priority, string> = {
  URGENT: 'bg-red-500',
  HIGH: 'bg-orange-500',
  MEDIUM: 'bg-amber-400',
  LOW: 'bg-slate-400',
};

const cardClass = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';

/** The PM's projects with progress, their open work by priority, and what's due in the coming week. */
export function PmSummaryPanel() {
  const { data, error, reload } = useApi<PmSummary>('/dashboard/pm/summary');

  if (error) return <ApiErrorAlert error={error} onRetry={reload} />;
  if (!data) return <SkeletonBlock className="h-64" />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={cardClass}>
        <h2 className="text-sm font-semibold">Your projects</h2>
        {data.projects.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">You don't own any projects yet.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {data.projects.map((project) => {
              const percentDone = project.tasks.total ? Math.round((project.tasks.done / project.tasks.total) * 100) : 0;
              return (
                <li key={project.id}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium text-slate-900">{project.name}</span>
                    <span className="whitespace-nowrap text-xs text-slate-500">
                      {project.tasks.done}/{project.tasks.total} done
                      {project.tasks.overdue > 0 && <span className="text-red-600"> · {project.tasks.overdue} overdue</span>}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-2 rounded-full bg-slate-100"
                    role="progressbar"
                    aria-label={`${project.name} progress`}
                    aria-valuenow={percentDone}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${percentDone}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <BreakdownBars
        title="Open tasks by priority"
        order={PRIORITIES}
        counts={data.openTasksByPriority}
        labels={PRIORITY_LABEL}
        barClass={PRIORITY_BAR}
      />

      <section className={`${cardClass} lg:col-span-2`}>
        <h2 className="text-sm font-semibold">Due in the next {data.upcoming.withinDays} days</h2>
        {data.upcoming.tasks.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nothing open is due this week.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {data.upcoming.tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{task.title}</p>
                  <p className="text-xs text-slate-500">
                    {task.project.name} · {task.assignee?.name ?? 'Unassigned'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <PriorityBadge priority={task.priority} />
                  <DueDate task={task} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
