import type { ReactNode } from 'react';
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, TASK_STATUSES } from './types';
import type { useTaskFilters } from './useTaskFilters';

type Filters = ReturnType<typeof useTaskFilters>;

const SORT_OPTIONS = [
  { value: 'dueDate', label: 'Due date (soonest first)' },
  { value: '-priority', label: 'Priority, then due date' },
  { value: '-createdAt', label: 'Newest first' },
];

const controlClass =
  'mt-1 block rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

/** A date input only accepts YYYY-MM-DD; anything else in the URL shows as empty (the API reports it). */
const asDateInputValue = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '');

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
        selected ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="w-16 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </div>
  );
}

/** Filter controls. They only ever write to the URL; the list re-fetches from whatever the URL says. */
export function TaskFilters({ filters }: { filters: Filters }) {
  return (
    <div className="space-y-3">
      <ChipGroup label="Status">
        {TASK_STATUSES.map((status) => (
          <Chip key={status} selected={filters.statuses.includes(status)} onClick={() => filters.toggle('status', status)}>
            {STATUS_LABEL[status]}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup label="Priority">
        {PRIORITIES.map((priority) => (
          <Chip
            key={priority}
            selected={filters.priorities.includes(priority)}
            onClick={() => filters.toggle('priority', priority)}
          >
            {PRIORITY_LABEL[priority]}
          </Chip>
        ))}
      </ChipGroup>
      <div className="flex flex-wrap items-end gap-3 pt-1">
        <label className="text-xs font-medium text-slate-600">
          Due from
          <input
            type="date"
            value={asDateInputValue(filters.dueFrom)}
            max={asDateInputValue(filters.dueTo) || undefined}
            onChange={(event) => filters.setDate('dueFrom', event.target.value)}
            className={controlClass}
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Due to
          <input
            type="date"
            value={asDateInputValue(filters.dueTo)}
            min={asDateInputValue(filters.dueFrom) || undefined}
            onChange={(event) => filters.setDate('dueTo', event.target.value)}
            className={controlClass}
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Sort
          <select value={filters.sort} onChange={(event) => filters.setSort(event.target.value)} className={controlClass}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {filters.hasFilters && (
          <button
            type="button"
            onClick={filters.clear}
            className="rounded-md px-3 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
