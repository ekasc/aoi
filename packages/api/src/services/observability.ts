import { Context, Effect, Layer } from 'effect';

import type { AnalyticsEngineDatasetBinding } from '../env';
import { Logger, type LoggerService } from '../effects/logger';

export interface RequestSummary {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
}

/**
 * Observability — the privacy-safe request log line + Analytics Engine
 * data points. Ground rules:
 * - request lines carry method + route path + status + duration only; never
 *   query strings, headers, bodies, ids, tokens, or coordinates,
 * - Analytics Engine is best-effort and optional (absent binding = no-op),
 * - nothing here can throw into the request path.
 */
export interface ObservabilityService {
  readonly recordRequest: (summary: RequestSummary) => void;
  readonly writeDataPoint: (event: {
    indexes?: string[];
    doubles?: number[];
    blobs?: Array<string | null>;
  }) => void;
}

export class Observability extends Context.Tag('aoi/Observability')<ObservabilityService, ObservabilityService>() {}

export function makeObservabilityService(options: {
  logger: LoggerService;
  analytics?: AnalyticsEngineDatasetBinding;
}): ObservabilityService {
  return {
    recordRequest(summary) {
      options.logger.info('request', {
        requestId: summary.requestId,
        method: summary.method,
        path: summary.path,
        status: summary.status,
        durationMs: summary.durationMs,
      });
    },
    writeDataPoint(event) {
      if (options.analytics) {
        try {
          options.analytics.writeDataPoint(event);
        } catch {
          // Best-effort: analytics must never break a request.
        }
      }
    },
  };
}

export const makeObservabilityLayer = (options: {
  logger: LoggerService;
  analytics?: AnalyticsEngineDatasetBinding;
}): Layer.Layer<ObservabilityService> =>
  Layer.succeed(Observability, makeObservabilityService(options));

export const makeObservabilityLayerFromContext = (
  analytics?: AnalyticsEngineDatasetBinding
): Layer.Layer<ObservabilityService, never, LoggerService> =>
  Layer.effect(
    Observability,
    Effect.map(Logger, (logger) => makeObservabilityService({ logger, analytics }))
  );

export const recordRequest = (summary: RequestSummary): Effect.Effect<void, never, ObservabilityService> =>
  Effect.tap(Observability, (s) => s.recordRequest(summary));

export const writeDataPoint = (event: {
  indexes?: string[];
  doubles?: number[];
  blobs?: Array<string | null>;
}): Effect.Effect<void, never, ObservabilityService> =>
  Effect.tap(Observability, (s) => s.writeDataPoint(event));
