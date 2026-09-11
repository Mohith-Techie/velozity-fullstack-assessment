import { isAxiosError } from 'axios';

/** One problem reported by the API's validation (Zod) layer, e.g. `{ field: "status.0", message: "Invalid option…" }`. */
export interface FieldError {
  field: string;
  message: string;
  code: string;
}

/** A failed API call, normalized from our `{ error: { code, message, details } }` envelope. */
export interface ApiError {
  /** HTTP status, or null when the server couldn't be reached. */
  status: number | null;
  code: string;
  message: string;
  details: FieldError[];
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
}

const GENERIC = 'Something went wrong. Please try again.';

export function toApiError(error: unknown): ApiError {
  if (!isAxiosError<ErrorEnvelope>(error)) return { status: null, code: 'UNKNOWN', message: GENERIC, details: [] };
  if (!error.response) {
    return { status: null, code: 'NETWORK_ERROR', message: 'Cannot reach the server. Check your connection.', details: [] };
  }
  const body = error.response.data?.error;
  return {
    status: error.response.status,
    code: body?.code ?? 'HTTP_ERROR',
    message: body?.message ?? GENERIC,
    details: Array.isArray(body?.details) ? (body.details as FieldError[]) : [],
  };
}

export const apiErrorMessage = (error: unknown): string => toApiError(error).message;
