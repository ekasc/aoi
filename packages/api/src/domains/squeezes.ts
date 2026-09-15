import { Effect } from 'effect';

import { Db, type DbService } from '../effects/d1';
import { Logger, type LoggerService } from '../effects/logger';
import { enqueueJob, type JobQueueService } from '../services/job-queue';
import { getActiveSpaceId } from './spaces';
import { BadRequestError, InternalError, badRequest } from './errors';

/**
 * Squeezes domain — a wordless "thinking of you" push. Delivered
 * fire-and-forget to the partner; nothing is stored. No row means nothing
 * sensitive to protect, purge, or leak.
 */

export const sendSqueezeProgram = (
  userId: string
): Effect.Effect<{ ok: true }, BadRequestError | InternalError, DbService | JobQueueService | LoggerService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to send a squeeze'));
    }

    yield* enqueueJob({ type: 'push.deliver', kind: 'squeeze', spaceId, fromUserId: userId });
    return { ok: true as const };
  });
