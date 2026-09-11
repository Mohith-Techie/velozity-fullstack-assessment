import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { useApi } from '../../hooks/useApi';
import { TaskFilters } from './TaskFilters';
import { TaskTable } from './TaskTable';
import type { TaskPage } from './types';
import { PAGE_SIZE, useTaskFilters } from './useTaskFilters';

interface TaskListPanelProps {
  title: string;
  /** Dashboard list endpoint, e.g. `/dashboard/admin/tasks`. */
  endpoint: string;
  /** Sort used when the URL doesn't name one. */
  defaultSort?: string;
  showAssignee?: boolean;
}

/** URL-driven task list: the filters write to the URL, and the list fetches exactly what the URL says. */
export function TaskListPanel({ title, endpoint, defaultSort, showAssignee = true }: TaskListPanelProps) {
  const filters = useTaskFilters(defaultSort ? { sort: defaultSort } : {});
  const { data, error, loading, reload } = useApi<TaskPage>(endpoint, filters.apiQuery);

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-slate-500" aria-live="polite">
          {loading ? 'Loading…' : data && `${data.pagination.total} ${data.pagination.total === 1 ? 'task' : 'tasks'}`}
        </span>
      </header>
      <div className="border-b border-slate-100 px-5 py-4">
        <TaskFilters filters={filters} />
      </div>

      {error ? (
        <div className="p-5">
          <ApiErrorAlert error={error} valueAt={filters.valueAt} onReset={filters.clear} onRetry={reload} />
        </div>
      ) : data ? (
        <div className={loading ? 'opacity-60 transition-opacity' : undefined}>
          <TaskTable tasks={data.data} showAssignee={showAssignee} />
          <Pagination {...data.pagination} onChange={filters.setOffset} />
        </div>
      ) : (
        <p className="px-5 py-10 text-center text-sm text-slate-500">Loading tasks…</p>
      )}
    </section>
  );
}

function Pagination({ total, offset, onChange }: { total: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= PAGE_SIZE) return null;
  const last = Math.min(offset + PAGE_SIZE, total);
  const buttonClass = 'rounded-md px-3 py-1.5 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-40';

  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
      <span>
        {offset + 1}–{last} of {total}
      </span>
      <div className="flex gap-2">
        <button type="button" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))} className={buttonClass}>
          Previous
        </button>
        <button type="button" disabled={last >= total} onClick={() => onChange(offset + PAGE_SIZE)} className={buttonClass}>
          Next
        </button>
      </div>
    </div>
  );
}
