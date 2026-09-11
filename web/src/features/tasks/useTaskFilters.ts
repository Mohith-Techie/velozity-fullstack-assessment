import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** URL query keys that belong to the task list. They are forwarded to the API exactly as they appear. */
const FILTER_KEYS = ['status', 'priority', 'dueFrom', 'dueTo', 'sort', 'offset'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type ListKey = 'status' | 'priority';

export const PAGE_SIZE = 20;

/**
 * Task-list filters live in the URL (via useSearchParams), so every filtered view is shareable, survives
 * reloads and works with the back button. Multi-value filters are written as repeated keys
 * (`?status=TODO&status=IN_REVIEW`); hand-written comma lists (`?status=TODO,IN_REVIEW`) are read too.
 *
 * Values are deliberately *not* validated here: the backend's Zod schema is the single source of truth, and
 * its errors are shown in the UI when someone hand-edits the URL (e.g. `?status=INVALID_STATUS`).
 */
export function useTaskFilters(defaults: Partial<Record<FilterKey, string>> = {}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const listValues = (key: ListKey) =>
    searchParams
      .getAll(key)
      .flatMap((value) => value.split(','))
      .filter(Boolean);

  /** Applies changes to the URL. Any filter change goes back to the first page. */
  const update = useCallback(
    (changes: Partial<Record<FilterKey, string | string[] | null>>, { keepPage = false } = {}) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          next.delete(key);
          for (const item of [value ?? []].flat()) if (item) next.append(key, item);
        }
        if (!keepPage) next.delete('offset');
        return next;
      });
    },
    [setSearchParams],
  );

  const toggle = (key: ListKey, value: string) => {
    const current = listValues(key);
    update({ [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] });
  };

  // What the API receives: the URL's filter params verbatim, plus defaults for anything the URL leaves out.
  const apiQuery = new URLSearchParams();
  for (const key of FILTER_KEYS) for (const value of searchParams.getAll(key)) apiQuery.append(key, value);
  for (const [key, value] of Object.entries(defaults)) if (value && !apiQuery.has(key)) apiQuery.set(key, value);
  apiQuery.set('limit', String(PAGE_SIZE));

  return {
    statuses: listValues('status'),
    priorities: listValues('priority'),
    dueFrom: searchParams.get('dueFrom') ?? '',
    dueTo: searchParams.get('dueTo') ?? '',
    sort: searchParams.get('sort') ?? defaults.sort ?? 'dueDate',
    offset: Number(searchParams.get('offset')) || 0,
    hasFilters: FILTER_KEYS.some((key) => key !== 'offset' && searchParams.has(key)),
    apiQuery: apiQuery.toString(),
    /** The raw URL value a backend validation error points at (`status.1` → the second status). */
    valueAt: (field: string): string | undefined => {
      const [key = '', index = '0'] = field.split('.');
      const values = key === 'status' || key === 'priority' ? listValues(key) : searchParams.getAll(key);
      return values[Number(index)];
    },
    toggle,
    setDate: (key: 'dueFrom' | 'dueTo', value: string) => update({ [key]: value || null }),
    setSort: (value: string) => update({ sort: value === defaults.sort ? null : value }),
    setOffset: (value: number) => update({ offset: value > 0 ? String(value) : null }, { keepPage: true }),
    clear: () => update(Object.fromEntries(FILTER_KEYS.map((key) => [key, null]))),
  };
}
