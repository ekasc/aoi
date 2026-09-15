import { Context, Effect, Layer } from 'effect';

import { InternalError } from '../domains/errors';

/**
 * Config — fail-fast, typed access to worker vars/secrets. Required values
 * throw a fixed InternalError at read time (never leak the missing key name
 * to the wire; log-level detail is handled by the caller).
 */
export interface ConfigService {
  readonly get: (key: string) => string | undefined;
  readonly getNumber: (key: string) => number | undefined;
  readonly require: (key: string) => string;
}

export class Config extends Context.Tag('aoi/Config')<ConfigService, ConfigService>() {}

export const get = (key: string): Effect.Effect<string | undefined, never, ConfigService> =>
  Effect.map(Config, (c) => c.get(key));

export const getNumber = (
  key: string
): Effect.Effect<number | undefined, never, ConfigService> =>
  Effect.map(Config, (c) => c.getNumber(key));

export const require_ = (
  key: string
): Effect.Effect<string, InternalError, ConfigService> =>
  Effect.flatMap(Config, (c) => {
    const value = c.get(key);
    if (value === undefined || value === '') {
      return Effect.fail(new InternalError({}));
    }
    return Effect.succeed(value);
  });

/**
 * Build a Config layer from a plain record (worker `env` vars in production,
 * a hand-built record in tests).
 */
export function makeConfigLayer(values: Record<string, string | undefined>): Layer.Layer<ConfigService> {
  return Layer.succeed(Config, {
    get: (key) => values[key],
    getNumber: (key) => {
      const raw = values[key];
      if (raw === undefined || raw === '') return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    },
    require: (key) => {
      const value = values[key];
      if (value === undefined || value === '') {
        throw new InternalError({});
      }
      return value;
    },
  });
}

/** Dev/test defaults (never secrets). */
export const DEFAULT_DEV_VARS: Record<string, string | undefined> = {
  CORS_ORIGIN: '*',
  APP_ENV: 'development',
  LOG_LEVEL: 'info',
};
