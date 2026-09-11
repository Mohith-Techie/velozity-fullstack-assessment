import { z } from 'zod';

export const projectIdParams = z.object({ projectId: z.uuid() });
export const taskIdParams = z.object({ taskId: z.uuid() });

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** ISO-8601 timestamp with a zone (e.g. 2026-09-30T17:00:00Z) parsed to a Date. */
export const isoDateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

/** A query parameter that may repeat (`?status=TODO&status=DONE`) or be comma-separated (`?status=TODO,DONE`). */
export const listParam = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (value) =>
      value === undefined
        ? undefined
        : [value]
            .flat()
            .flatMap((entry) => String(entry).split(','))
            .map((entry) => entry.trim())
            .filter(Boolean),
    z.array(item).min(1).optional(),
  );

/**
 * A date-range bound: a bare date (`2026-09-30`, whole day in UTC) or a full ISO date-time.
 * `edge` decides whether a bare date means the start or the end of that day.
 */
export const dateBound = (edge: 'start' | 'end') =>
  z
    .union([z.iso.datetime({ offset: true }), z.iso.date()], {
      error: 'must be a date (2026-09-30) or an ISO date-time (2026-09-30T17:00:00Z)',
    })
    .transform(
      (value) =>
        new Date(value.length === 10 ? `${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z` : value),
    );

export interface FieldError {
  /** Dotted path of the offending input (`status.1`, `dueTo`), or the unknown key names. */
  field: string;
  message: string;
  /** Zod issue code, e.g. `invalid_value`, `unrecognized_keys`, `too_big`. */
  code: string;
}

/** Zod issues → a flat, readable list for API clients. */
export function formatZodIssues(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.code === 'unrecognized_keys' ? issue.keys.join(', ') : issue.path.map(String).join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));
}
