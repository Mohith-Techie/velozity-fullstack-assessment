import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../lib/httpError.js';
import { formatZodIssues } from '../lib/validation.js';

// Every error response has the same shape, and nothing internal (stack traces, SQL, Prisma or driver
// messages) ever reaches the client:
//   { "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [...] } }

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/** Errors raised by express.json() / body-parser (malformed JSON, payload too large, ...). */
function isBodyParserError(error: unknown): error is { status: number; type: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof error.type === 'string' &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500
  );
}

function toErrorResponse(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof HttpError) {
    return { status: error.status, body: { code: error.code, message: error.message, details: error.details } };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: formatZodIssues(error) },
    };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2025': // a scoped write matched nothing: deleted, or changed hands after the ownership check
        return { status: 404, body: { code: 'NOT_FOUND', message: 'Resource not found' } };
      case 'P2002':
        return { status: 409, body: { code: 'CONFLICT', message: 'A record with these values already exists' } };
      case 'P2003':
        return { status: 409, body: { code: 'CONFLICT', message: 'A related record is missing or still in use' } };
    }
  }
  if (isBodyParserError(error)) {
    if (error.type === 'entity.parse.failed') {
      return { status: 400, body: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } };
    }
    if (error.type === 'entity.too.large') {
      return { status: 413, body: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } };
    }
    return { status: error.status, body: { code: 'BAD_REQUEST', message: 'Malformed request' } };
  }
  return { status: 500, body: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
}

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  const { status, body } = toErrorResponse(error);
  if (status >= 500) console.error(`${req.method} ${req.originalUrl} failed:`, error); // details stay server-side
  if (res.headersSent) return next(error); // mid-stream: let Express close the connection
  res.status(status).json({ error: body });
};
