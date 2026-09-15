import { Data, Context, Effect, Layer } from 'effect';
import { z } from 'zod';

import type { QueueBatchLike, QueueProducer } from '../env';
import { pushNotificationKindSchema } from '@aoi/shared';
import { Logger, type LoggerService } from '../effects/logger';

/**
 * Queue consumer — the single entry point for background work.
 *
 * Policy (locked design):
 * - every message is a tagged-union job, decoded strictly (zod);
 * - decode failures (poison messages) go to the DLQ immediately;
 * - business failures retry up to MAX_ATTEMPTS, then go to the DLQ;
 * - the DLQ send is best-effort — it can never fail the consumer.
 *
 * Handlers are injected via the `QueueHandlers` layer so tests capture
 * invocations and later stages register real implementations
 * (push.deliver → Stage 9, media.sanitize → Stage 10).
 */

export const QUEUE_JOB_TYPES = ['push.deliver', 'media.sanitize'] as const;

export const queueJobSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('push.deliver'),
    kind: pushNotificationKindSchema,
    spaceId: z.string().min(1),
    fromUserId: z.string().min(1),
    fromName: z.string().optional(),
    dayOfWeek: z.string().optional(),
  }),
  z.object({
    type: z.literal('media.sanitize'),
    mediaId: z.string().min(1),
  }),
]);

export type QueueJob = z.infer<typeof queueJobSchema>;

/** Maximum attempts before a business-failing job lands in the DLQ. */
export const MAX_JOB_ATTEMPTS = 5;

export class JobDecodeError extends Data.TaggedError('JobDecodeError')<{
  readonly message: string;
}> {}

export class JobFailure extends Data.TaggedError('JobFailure')<{
  readonly jobType: string;
  readonly cause?: unknown;
}> {}

/** A fully-wired handler: job → Effect that never requires services. */
export type QueueHandler = (job: QueueJob) => Effect.Effect<void, unknown, never>;

export interface QueueHandlersService {
  readonly handlers: Partial<Record<QueueJob['type'], QueueHandler>>;
}

export class QueueHandlers extends Context.Tag('aoi/QueueHandlers')<QueueHandlersService, QueueHandlersService>() {}

export const makeQueueHandlersLayer = (
  handlers: Partial<Record<QueueJob['type'], QueueHandler>>
) => Layer.succeed(QueueHandlers, { handlers });

/**
 * Skeleton handlers for the foundation stage: log-only no-ops. They ack
 * cleanly so the queue never blocks; real implementations land in Stages 9/10.
 */
export const makeNoopQueueHandlersLayer = () =>
  makeQueueHandlersLayer({
    'push.deliver': () => Effect.void,
    'media.sanitize': () => Effect.void,
  });

export interface DlqSenderService {
  readonly send: (body: unknown) => Effect.Effect<void, never, never>;
}

export class DlqSender extends Context.Tag('aoi/DlqSender')<DlqSenderService, DlqSenderService>() {}

export const makeDlqSenderLayer = (dlq: QueueProducer) =>
  Layer.succeed(DlqSender, {
    send: (body) =>
      Effect.tryPromise({
        try: () => dlq.send(body),
        catch: () => new Error('dlq send failed'),
      }).pipe(
        // Best-effort: a failed DLQ write is contained, never thrown.
        Effect.catchAll(() => Effect.void)
      ),
  });

function decodeJob(body: unknown): QueueJob | JobDecodeError {
  const parsed = queueJobSchema.safeParse(body);
  if (!parsed.success) {
    return new JobDecodeError({ message: 'unrecognized job' });
  }
  return parsed.data;
}

function processMessage(
  message: QueueBatchLike['messages'][number],
  handlers: Partial<Record<QueueJob['type'], QueueHandler>>,
  logger: LoggerService
): Effect.Effect<void, never, DlqSenderService> {
  const decoded = decodeJob(message.body);

  if (decoded instanceof JobDecodeError) {
    return Effect.gen(function* () {
      logger.warn('queue: undecodable message to DLQ', { jobId: message.id });
      yield* Effect.flatMap(DlqSender, (s) => s.send({ _meta: { reason: 'decode' }, body: message.body }));
      message.ack();
    });
  }

  const handler = handlers[decoded.type];

  if (!handler) {
    return Effect.gen(function* () {
      logger.warn('queue: no handler for job type', { jobId: message.id, jobType: decoded.type });
      yield* Effect.flatMap(DlqSender, (s) =>
        s.send({ _meta: { reason: 'no-handler', jobType: decoded.type }, body: message.body })
      );
      message.ack();
    });
  }

  // Contain sync throws from handlers (e.g. a buggy handler that throws
  // instead of failing): Effect.try converts a throwing thunk into a
  // failure, then flatten lifts the handler's Effect one level so
  // matchEffect sees both sync throws and Effect failures as onFailure.
  const run = Effect.try(() => handler(decoded)).pipe(Effect.flatten);

  return Effect.matchEffect(run, {
    onSuccess: () => Effect.sync(() => message.ack()),
    onFailure: () =>
      Effect.gen(function* () {
        if (message.attempts < MAX_JOB_ATTEMPTS) {
          logger.warn('queue: job retried', { jobId: message.id, jobType: decoded.type, attempts: message.attempts });
          message.retry();
        } else {
          logger.error('queue: job to DLQ after retries', { jobId: message.id, jobType: decoded.type });
          yield* Effect.flatMap(DlqSender, (s) =>
            s.send({ _meta: { reason: 'failed', jobType: decoded.type, attempts: message.attempts }, body: message.body })
          );
          message.ack();
        }
      }),
  });
}

/**
 * Consume a batch: decode → dispatch → ack/retry/DLQ per message.
 * Never throws; failures are contained per-message.
 */
export const consumeQueueBatch = (
  batch: QueueBatchLike
): Effect.Effect<void, never, QueueHandlersService | DlqSenderService | LoggerService> =>
  Effect.gen(function* () {
    const handlersService = yield* QueueHandlers;
    const logger = yield* Logger;

    for (const message of batch.messages) {
      yield* processMessage(message, handlersService.handlers, logger);
    }
  });
