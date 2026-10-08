import { AppError } from './errorHandler.js';

/**
 * Zod validation middleware.
 *
 *   validate({ body: schema, query: schema, params: schema })
 *
 * On success, replaces req[part] with the parsed value (unknown keys stripped,
 * types coerced). On failure, forwards a 400 AppError with per-field details to
 * the central error handler.
 */
export function validate(schemas) {
  return (req, _res, next) => {
    for (const part of ['body', 'query', 'params']) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        }));
        return next(
          new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details),
        );
      }
      req[part] = result.data;
    }
    next();
  };
}
