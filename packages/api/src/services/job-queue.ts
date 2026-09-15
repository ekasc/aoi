import { Context, Effect, Layer } from 'effect';

import type { QueueProducer } from '../env';
import type { QueueJob } from '../programs/queue';
import { Logger, type LoggerService } from '../effects/logger';

/**
 * JobQueue — the ONLY way programs enqueue background work. One queue
 * architecture: every job type (`push.deliver`, `media.sanitize`) flows
 * through this service into the single AOI_QUEUE producer, and the queue
 * consumer (`programs/queue.ts`) dispatches by tagged union.
 *
 * Ground rule: enqueue NEVER breaks the request path. A producer failure is
 * logged (dev) and swallowed — the request that triggered the notification
 * already succeeded; the push is best-effort by design.
 */
export interface JobQueueService {
  readonly enqueue: (job: QueueJob) => Promise<void>;
}

export class JobQueue extends Context.Tag('aoi/JobQueue')<JobQueueService, JobQueueService>() {}

export const makeJobQueueLayer = (producer: QueueProducer): Layer.Layer<JobQueueService> =>
  Layer.succeed(JobQueue, {
    enqueue: (job) => producer.send(job),
  });

/**
 * Enqueue a job; any failure is contained (logged, never thrown). The
 * program's success does not depend on the queue.
 */
export const enqueueJob = (
  job: QueueJob
): Effect.Effect<void, never, JobQueueService | LoggerService> =>
  Effect.flatMap(JobQueue, (s) =>
    Effect.tryPromise({
      try: () => s.enqueue(job),
      catch: (cause) => new Error(`job enqueue failed: ${String(cause)}`),
    })
  ).pipe(
    Effect.catchAll((error) =>
      Effect.flatMap(Logger, (logger) => {
        logger.warn('queue: enqueue failed (request continues)', {
          jobType: job.type,
          error: error instanceof Error ? error.message : 'unknown',
        });
        return Effect.void;
      })
    )
  );
