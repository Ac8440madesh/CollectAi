import { isProd } from '../config/env.js';

/**
 * 404 handler — any request that didn't match a route lands here.
 */
export function notFound(req, res, _next) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
  });
}

/**
 * Central error handler.
 *
 * Produces the consistent envelope `{ error: { code, message, details? } }`.
 * - Never leaks stack traces in production.
 * - 5xx errors are logged server-side.
 *
 * Throw/next() an error shaped like `{ status, code, message, details }`
 * (see the `AppError` helper) to control the response.
 *
 * Must keep all four args so Express recognizes it as error middleware.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const code = err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
  const message =
    status >= 500 && isProd ? 'Internal server error' : err.message || 'Internal server error';

  const body = { error: { code, message } };
  if (err.details) body.error.details = err.details;
  // Dev-only aid; never sent in production.
  if (!isProd && err.stack) body.error.stack = err.stack;

  if (status >= 500) console.error(err);

  res.status(status).json(body);
}

/**
 * Small helper to throw errors the handler understands.
 * Example: `throw new AppError(404, 'NOT_FOUND', 'Client not found')`.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}
