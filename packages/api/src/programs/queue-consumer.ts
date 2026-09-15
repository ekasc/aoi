import { Effect, Layer } from 'effect';

import type { QueueJob } from './queue';
import { QueueHandlers } from './queue';
import { buildPushCopy } from '../lib/push-copy';
import { Db, type DbService } from '../effects/d1';
import { Logger, type LoggerService } from '../effects/logger';
import { Config } from '../effects/config';
import { sanitizeMediaJob } from '../services/media-processing';

/**
 * Real queue handlers — the off-request delivery engines:
 * - `push.deliver`: partner notification via Expo (batched ≤100, 10s abort,
 *   dead-token pruning scoped to the recipient). Copy is built by
 *   `lib/push-copy` — kind only, never content.
 * - `media.sanitize`: EXIF-stripping re-encode (see media-processing.ts).
 *
 * Both are idempotent: push re-delivery re-sends vague copy (harmless) and
 * prunes tokens idempotently; sanitize re-delivery is a guarded no-op via
 * the media state machine. Failures flow to the consumer's retry → DLQ
 * policy; the jobs themselves never throw uncontained.
 */

const DEFAULT_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

// Expo accepts up to 100 messages per request.
const PUSH_BATCH_SIZE = 100;

// A hung Expo endpoint must never stall the consumer — abort instead.
const PUSH_FETCH_TIMEOUT_MS = 10_000;

// Ticket errors that mean the token itself is dead (device uninstalled the
// app, token invalidated). Other errors are transient — keep the token.
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidPushToken']);

interface ExpoPushTicket {
  id?: string;
  status: 'ok' | 'error';
  details?: { error?: string };
}

interface ExpoPushResponse {
  data?: ExpoPushTicket[] | ExpoPushTicket;
  errors?: { message?: string }[];
}

export function toExpoMessage(token: string, message: { title: string; body: string; data: Record<string, string> }): Record<string, unknown> {
  return {
    to: token,
    title: message.title,
    body: message.body,
    // Silent by default — memories must never become noise.
    sound: null,
    data: message.data,
  };
}

async function postToExpo(endpoint: string, messages: Record<string, unknown>[]): Promise<ExpoPushTicket[]> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(PUSH_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Push endpoint responded ${response.status}`);
  }

  const parsed = (await response.json()) as ExpoPushResponse;

  if (Array.isArray(parsed.data)) {
    return parsed.data;
  }
  if (parsed.data && typeof parsed.data === 'object') {
    return [parsed.data];
  }
  return [];
}

/**
 * Deliver one notification to the partner of `spaceId` (the active member
 * that is not `fromUserId`). Kind-only payload — vague copy, no content.
 */
export const deliverPushJob = (
  job: Extract<QueueJob, { type: 'push.deliver' }>
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const logger = yield* Logger;

    const members = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select user_id from space_members where space_id = ? and state = 'active'`
          )
          .bind(job.spaceId)
          .all<{ user_id: string }>(),
      catch: () => new Error('push: member lookup failed'),
    });

    const memberRows = members.results ?? [];
    const partner = memberRows.find((member) => member.user_id !== job.fromUserId);
    if (!partner) {
      return; // No partner (single-member space) — nothing to do.
    }

    const tokens = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare('select expo_push_token from push_tokens where user_id = ?')
          .bind(partner.user_id)
          .all<{ expo_push_token: string }>(),
      catch: () => new Error('push: token lookup failed'),
    });

    const tokenRows = tokens.results ?? [];
    if (tokenRows.length === 0) {
      return; // Recipient has no registered devices.
    }

    const copy = buildPushCopy(job.kind, job.fromName, job.dayOfWeek);
    const message = { title: copy.title, body: copy.body, data: { kind: job.kind } };

    const endpoint = yield* Effect.map(Config, (config) =>
      config.get('EXPO_PUSH_ENDPOINT') ?? DEFAULT_PUSH_ENDPOINT
    );

    const deadTokens: string[] = [];

    for (let start = 0; start < tokenRows.length; start += PUSH_BATCH_SIZE) {
      const batch = tokenRows.slice(start, start + PUSH_BATCH_SIZE);
      const tickets = yield* Effect.tryPromise({
        try: () => postToExpo(endpoint, batch.map((row) => toExpoMessage(row.expo_push_token, message))),
        catch: (cause) => new Error(`push: expo post failed (${String(cause)})`),
      });

      tickets.forEach((ticket, index) => {
        if (
          ticket.status === 'error' &&
          ticket.details?.error &&
          DEAD_TOKEN_ERRORS.has(ticket.details.error)
        ) {
          const dead = batch[index]?.expo_push_token;
          if (dead) {
            deadTokens.push(dead);
          }
        }
      });
    }

    if (deadTokens.length > 0) {
      // Token cleanup, scoped to the recipient — a token can only be pruned
      // for the user it currently belongs to. Idempotent by construction.
      const placeholders = deadTokens.map(() => '?').join(', ');
      yield* Effect.tryPromise({
        try: () =>
          db.d1
            .prepare(
              `delete from push_tokens where user_id = ? and expo_push_token in (${placeholders})`
            )
            .bind(partner.user_id, ...deadTokens)
            .run(),
        catch: () => new Error('push: dead-token prune failed'),
      }).pipe(
        Effect.catchAll(() =>
          Effect.flatMap(Logger, (l) => {
            l.warn('push: dead-token prune failed', { count: deadTokens.length });
            return Effect.void;
          })
        )
      );
    }

    logger.info('push: delivered', { kind: job.kind, recipient: partner.user_id, tokens: tokenRows.length, dead: deadTokens.length });
    return;
  });

/**
 * Wire the real handlers into a QueueHandlers layer. Each handler provides
 * the runtime `layer` to its program at invocation time (programs declare
 * their service requirements; the layer is built once per worker).
 */
export function makeRealQueueHandlers(layer: Layer.Layer<never, never, never>) {
  return Layer.succeed(QueueHandlers, {
    handlers: {
      'push.deliver': (job) => Effect.provide(deliverPushJob(job as Extract<QueueJob, { type: 'push.deliver' }>), layer) as Effect.Effect<void, unknown, never>,
      'media.sanitize': (job) => Effect.provide(sanitizeMediaJob((job as Extract<QueueJob, { type: 'media.sanitize' }>).mediaId), layer) as Effect.Effect<void, unknown, never>,
    },
  });
}
