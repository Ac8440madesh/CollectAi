import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from './errorHandler.js';

/**
 * Require a valid JWT. Reads `Authorization: Bearer <token>`, verifies it, and
 * attaches `req.user = { id, email }`. Every protected route uses this, and
 * every query then scopes by `req.user.id` so users can't touch each other's
 * data (CLAUDE.md §2, §10).
 */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Missing or malformed Authorization header'));
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    next(new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
  }
}
