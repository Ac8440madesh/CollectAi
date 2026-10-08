import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env.js';

const envelope = (message) => ({ error: { code: 'RATE_LIMITED', message } });

// Rate limiting is disabled under tests so repeated requests don't flake.
const skip = () => isTest;

/**
 * General API limiter.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: envelope('Too many requests. Please try again in a little while.'),
});

/**
 * Stricter limiter for auth routes (login/register) to blunt brute-force.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: envelope('Too many attempts. Please wait a few minutes and try again.'),
});

/**
 * Rate limiter for LLM-triggering endpoints (/api/agents/run, /api/communications/inbound).
 * Keyed by authenticated user ID (fallback to IP for safety).
 */
export const llmEndpointLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: envelope('Too many agent/LLM requests. Please slow down and try again shortly.'),
});
