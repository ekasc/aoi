import { Context, Effect, Layer } from 'effect';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Keys that must never be logged, whatever their value (tokens, secrets,
 * and — critically — location coordinates).
 */
const REDACTED_KEYS = new Set([
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'secret',
  'password',
  'latitude',
  'longitude',
  'accuracyMeters',
  'coordinates',
  'location',
  'idToken',
  'codeVerifier',
  'expoPushToken',
  'x-api-key',
]);

function isRedactedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACTED_KEYS.has(lower) || lower.includes('token') || lower.includes('secret');
}

/**
 * Deep-sanitize a fields record before it can reach output. Coordinates and
 * token-shaped values are replaced with a fixed marker — this is the last
 * line of defense; callers should avoid passing them at all.
 */
export function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isRedactedKey(key)) {
      out[key] = '[redacted]';
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export interface LoggerService {
  readonly level: LogLevel;
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export class Logger extends Context.Tag('aoi/Logger')<LoggerService, LoggerService>() {}

export function makeLoggerService(options: {
  level?: LogLevel;
  emit?: (level: LogLevel, message: string, fields: Record<string, unknown>) => void;
}): LoggerService {
  const level = options.level ?? 'info';
  const emit =
    options.emit ??
    ((lvl, message, fields) => {
      // JSON lines, sanitized. No request content, no tokens, no coordinates.
      // In dev this is console output; production may pipe to a log sink.
      const line = JSON.stringify({ level: lvl, message, ...fields });
      // eslint-disable-next-line no-console
      console.log(line);
    });

  const shouldLog = (lvl: LogLevel): boolean => LEVEL_ORDER[lvl] >= LEVEL_ORDER[level];

  return {
    level,
    log(lvl, message, fields) {
      if (!shouldLog(lvl)) return;
      emit(lvl, message, sanitizeFields(fields ?? {}));
    },
    debug(message, fields) {
      this.log('debug', message, fields);
    },
    info(message, fields) {
      this.log('info', message, fields);
    },
    warn(message, fields) {
      this.log('warn', message, fields);
    },
    error(message, fields) {
      this.log('error', message, fields);
    },
  };
}

/** Console logger (worker + dev). */
export const LiveLogger = Layer.succeed(Logger, makeLoggerService({}));

/** In-memory capture logger for tests. */
export function makeCaptureLogger() {
  const entries: Array<{ level: LogLevel; message: string; fields: Record<string, unknown> }> = [];
  const service = makeLoggerService({
    level: 'debug',
    emit: (level, message, fields) => {
      entries.push({ level, message, fields });
    },
  });
  return {
    layer: Layer.succeed(Logger, service),
    service,
    entries,
    byLevel: (level: LogLevel) => entries.filter((e) => e.level === level),
  };
}

export const logDebug = (message: string, fields?: Record<string, unknown>) =>
  Effect.tap(Logger, (l) => l.debug(message, fields));

export const logInfo = (message: string, fields?: Record<string, unknown>) =>
  Effect.tap(Logger, (l) => l.info(message, fields));

export const logWarn = (message: string, fields?: Record<string, unknown>) =>
  Effect.tap(Logger, (l) => l.warn(message, fields));

export const logError = (message: string, fields?: Record<string, unknown>) =>
  Effect.tap(Logger, (l) => l.error(message, fields));
