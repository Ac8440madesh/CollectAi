import rateLimit from 'express-rate-limit';

/**
 * General API rate limiter.
 *
 * A stricter limiter for auth routes (login/register) is added in Phase 1.
 * Uses the standard `RateLimit-*` headers and our consistent error envelope.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again in a little while.',
    },
  },
});
