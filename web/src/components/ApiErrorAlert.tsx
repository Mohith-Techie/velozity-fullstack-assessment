import type { ApiError } from '../api/errors';

const FIELD_LABEL: Record<string, string> = {
  status: 'Status',
  priority: 'Priority',
  dueFrom: 'Due from',
  dueTo: 'Due to',
  sort: 'Sort',
  offset: 'Page',
  limit: 'Page size',
};

const labelFor = (field: string) => FIELD_LABEL[field.split('.')[0] ?? field] ?? field;

/** Zod lists enum options as "A"|"B"; read better as "A", "B". */
const readable = (message: string) => message.replaceAll('"|"', '", "');

interface ApiErrorAlertProps {
  error: ApiError;
  /** Looks up the value a field error refers to (e.g. from the URL), so the user sees what was wrong. */
  valueAt?: (field: string) => string | undefined;
  onReset?: () => void;
  onRetry?: () => void;
}

/**
 * Shows an API failure without dumping raw JSON. Validation errors (the backend's Zod details) become one
 * readable line per problem, with a way back to a valid view; other failures get their message and a retry.
 */
export function ApiErrorAlert({ error, valueAt, onReset, onRetry }: ApiErrorAlertProps) {
  const isValidation = error.code === 'VALIDATION_ERROR';

  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">{isValidation ? 'Some filters in this link aren’t valid.' : error.message}</p>
      {error.details.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {error.details.map((detail, index) => {
            const value = valueAt?.(detail.field);
            return (
              <li key={`${detail.field}-${index}`}>
                <span className="font-medium">{labelFor(detail.field)}</span>
                {value !== undefined && <> “{value}”</>}: {readable(detail.message)}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        {isValidation && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-md bg-white px-3 py-1.5 font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-100"
          >
            Reset filters
          </button>
        )}
        {!isValidation && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-white px-3 py-1.5 font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-100"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
