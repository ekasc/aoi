import { createMiddleware } from 'hono/factory';
import { tooMany } from '../lib/errors.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const timer: ReturnType<typeof setInterval> = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, CLEANUP_INTERVAL);
// unref timer to not block process exit
if (timer && typeof timer === 'object') (timer as any).unref?.();

export interface RateLimitOptions {
  /** Max requests in the window */
  max: number;
  /** Window duration in seconds */
  windowSec: number;
  /** Function to derive the rate limit key from context */
  keyFn?: (c: any) => string;
}

export function rateLimit(options: RateLimitOptions) {
  const { max, windowSec } = options;
  const windowMs = windowSec * 1000;

  return createMiddleware(async (c, next) => {
    const key = options.keyFn?.(c) ?? c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';
    const now = Date.now();

    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      throw tooMany('Too many requests. Please try again later.');
    }

    await next();
  });
}
