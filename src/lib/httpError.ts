/** An error that maps directly to an HTTP response (see middleware/errorHandler.ts). */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') =>
  new HttpError(401, code, message);

export const forbidden = (message: string) => new HttpError(403, 'FORBIDDEN', message);

export const notFound = (resource: string) => new HttpError(404, 'NOT_FOUND', `${resource} not found`);

export const unprocessable = (message: string) => new HttpError(422, 'UNPROCESSABLE', message);
