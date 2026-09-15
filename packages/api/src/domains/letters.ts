import { Effect } from 'effect';

import {
  LETTER_SEAL_MAX_HORIZON_DAYS,
  type Letter,
  type SealLetterRequest,
} from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { newId, type IdService } from '../effects/id';
import { Db, type DbService } from '../effects/d1';
import { Logger, type LoggerService } from '../effects/logger';
import { enqueueJob, type JobQueueService } from '../services/job-queue';
import { getActiveSpaceId } from './spaces';
import {
  BadRequestError,
  InternalError,
  LimitExceededError,
  NotFoundError,
  badRequest,
  limitExceeded,
  notFound,
} from './errors';
import { readSpaceUsage } from './plus';

/**
 * Letters domain — time capsules. Sealing is final: a letter is written
 * once and never touched again except by the open transition. Unopened
 * bodies never leave the server (serializer-enforced). Opening is a
 * guarded one-way atomic UPDATE (`WHERE opened_at IS NULL`), so two people
 * tapping at once can never race: one writes, the other reads the opened
 * row. Letters are IMMUTABLE — deliberately no PATCH or DELETE.
 */

export interface LetterRow {
  id: string;
  space_id: string;
  author_user_id: string;
  caption: string | null;
  body: string;
  sealed_until: number;
  created_at: number;
  opened_at: number | null;
}

const LETTER_SELECT = `
  select l.id, l.space_id, l.author_user_id, l.caption, l.body,
         l.sealed_until, l.created_at, l.opened_at, u.name as author_name
  from letters l
  join users u on u.id = l.author_user_id
`;

/**
 * THE LOCK lives here: the body only ever leaves the server once the letter
 * has been opened — for the partner and the author alike. Unopened letters
 * are serialized without a `body` key at all.
 */
export function letterToApi(row: LetterRow, authorName: string, viewerUserId: string, now: number): Letter {
  const isOwn = row.author_user_id === viewerUserId;
  const isOpened = row.opened_at !== null;
  const letter: Letter = {
    id: row.id,
    authorRole: isOwn ? 'you' : 'partner',
    authorName: isOwn ? 'You' : authorName,
    caption: row.caption,
    sealedUntil: new Date(row.sealed_until).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    isOpened,
    readyToOpen: now >= row.sealed_until,
    openedAt: row.opened_at === null ? null : new Date(row.opened_at).toISOString(),
  };
  if (isOpened) {
    letter.body = row.body;
  }
  return letter;
}

// ── Seal a letter ────────────────────────────────────────────────────────
// Sealing is final: the row is written once and never touched again except
// by the open transition. The response already omits the body.

export const sealLetterProgram = (
  userId: string,
  input: SealLetterRequest
): Effect.Effect<Letter, BadRequestError | LimitExceededError | InternalError, DbService | JobQueueService | ClockService | IdService | LoggerService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest('You must have an active space to seal a letter'));
    }

    const at = yield* nowMs;
    const sealedUntil = Date.parse(input.sealedUntil);
    if (!Number.isFinite(sealedUntil)) {
      return yield* Effect.fail(badRequest("That opening day doesn't look quite right"));
    }
    if (!(sealedUntil > at)) {
      return yield* Effect.fail(badRequest('A letter can only open in the future'));
    }
    const DAY_MS = 24 * 60 * 60 * 1000;
    if (sealedUntil > at + LETTER_SEAL_MAX_HORIZON_DAYS * DAY_MS) {
      return yield* Effect.fail(badRequest("That's farther away than letters can wait"));
    }

    const db = yield* Db;
    const id = yield* newId;

    // Future-letter allowance in ONE statement: Free Spaces hold one
    // unopened future-sealed letter at a time; Plus is unbounded. Active =
    // opened_at IS NULL — opened letters never count, and due-but-unopened
    // letters still occupy the slot until actually opened (opening is never
    // blocked, so a downgraded Space always has a way forward). Atomic under
    // serialized writes: two simultaneous seals cannot both pass on Free.
    const usage = yield* readSpaceUsage(db.d1, spaceId, at);
    const letterLimit = usage.futureLetterLimit;
    const sealed = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into letters
               (id, space_id, author_user_id, caption, body, sealed_until, created_at)
             select ?, ?, ?, ?, ?, ?, ?
             where ? is null or (select count(*) from letters
                                 where space_id = ? and opened_at is null) < ?`
          )
          .bind(
            id,
            spaceId,
            userId,
            input.caption && input.caption.length > 0 ? input.caption : null,
            input.body,
            sealedUntil,
            at,
            letterLimit,
            spaceId,
            letterLimit ?? 0
          )
          .run(),
      catch: () => new InternalError({}),
    });
    if ((sealed.meta?.changes ?? 0) === 0 && letterLimit !== null) {
      return yield* Effect.fail(
        limitExceeded('This space already holds its future letter', {
          kind: 'future_letters',
          usedCount: usage.activeFutureLetters,
          limitCount: letterLimit,
        })
      );
    }

    yield* enqueueJob({ type: 'push.deliver', kind: 'letter_sealed', spaceId, fromUserId: userId });

    const author = yield* Effect.tryPromise({
      try: () =>
        db.d1.prepare('select name from users where id = ? limit 1').bind(userId).first<{ name: string }>(),
      catch: () => new InternalError({}),
    });

    return letterToApi(
      {
        id,
        space_id: spaceId,
        author_user_id: userId,
        caption: input.caption && input.caption.length > 0 ? input.caption : null,
        body: input.body,
        sealed_until: sealedUntil,
        created_at: at,
        opened_at: null,
      },
      author?.name ?? 'You',
      userId,
      at
    );
  });

// ── List the shelf ───────────────────────────────────────────────────────
// Every letter in the space, newest first. Unopened letters come back
// without a body — for the partner AND the author who sealed them.

export const listLettersProgram = (
  userId: string
): Effect.Effect<Letter[], InternalError, DbService | ClockService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return [];
    }

    const at = yield* nowMs;
    const db = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `${LETTER_SELECT}
             where l.space_id = ?
             order by l.created_at desc, l.id desc`
          )
          .bind(spaceId)
          .all<(LetterRow & { author_name: string })>(),
      catch: () => new InternalError({}),
    });

    return (rows.results ?? [])
      .map((row) =>
        letterToApi(
          {
            id: row.id,
            space_id: row.space_id,
            author_user_id: row.author_user_id,
            caption: row.caption,
            body: row.body,
            sealed_until: row.sealed_until,
            created_at: row.created_at,
            opened_at: row.opened_at,
          },
          row.author_name,
          userId,
          at
        )
      )
      .sort((left, right) => {
        if (left.createdAt === right.createdAt) return 0;
        return left.createdAt > right.createdAt ? -1 : 1;
      });
  });

// ── Open a letter ────────────────────────────────────────────────────────
// If it is due and still sealed, opening is one atomic guarded UPDATE
// (`WHERE opened_at IS NULL`), so two people tapping at once never race:
// one writes, the other reads the opened row. Not due → calm 400. Already
// open → idempotent read. Non-members (and ids from other spaces) → 404.

export const openLetterProgram = (
  userId: string,
  letterId: string
): Effect.Effect<Letter, BadRequestError | NotFoundError | InternalError, DbService | ClockService> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const at = yield* nowMs;

    const existing = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${LETTER_SELECT} where l.id = ? limit 1`)
          .bind(letterId)
          .first<(LetterRow & { author_name: string })>(),
      catch: () => new InternalError({}),
    });
    if (!existing) {
      return yield* Effect.fail(notFound('Letter not found'));
    }

    // Membership gate: another space's letter is indistinguishable from none.
    const member = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            "select 1 from space_members where space_id = ? and user_id = ? and state = 'active' limit 1"
          )
          .bind(existing.space_id, userId)
          .first(),
      catch: () => new InternalError({}),
    });
    if (!member) {
      return yield* Effect.fail(notFound('Letter not found'));
    }

    if (existing.opened_at !== null) {
      // Already open — reading it again is quiet and idempotent.
      return letterToApi(
        {
          id: existing.id,
          space_id: existing.space_id,
          author_user_id: existing.author_user_id,
          caption: existing.caption,
          body: existing.body,
          sealed_until: existing.sealed_until,
          created_at: existing.created_at,
          opened_at: existing.opened_at,
        },
        existing.author_name,
        userId,
        at
      );
    }

    if (at < existing.sealed_until) {
      return yield* Effect.fail(badRequest('Not yet time'));
    }

    const result = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `update letters set opened_at = ?, opened_by_user_id = ?
             where id = ? and opened_at is null`
          )
          .bind(at, userId, letterId)
          .run(),
      catch: () => new InternalError({}),
    });

    if ((result.meta?.changes ?? 0) > 0) {
      // Won the race — the opened row is this one.
      return letterToApi(
        {
          id: existing.id,
          space_id: existing.space_id,
          author_user_id: existing.author_user_id,
          caption: existing.caption,
          body: existing.body,
          sealed_until: existing.sealed_until,
          created_at: existing.created_at,
          opened_at: at,
        },
        existing.author_name,
        userId,
        at
      );
    }

    // Lost the race: someone opened it between the check and the write.
    // Read the freshly opened row (membership was already established).
    const fresh = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(`${LETTER_SELECT} where l.id = ? limit 1`)
          .bind(letterId)
          .first<(LetterRow & { author_name: string })>(),
      catch: () => new InternalError({}),
    });
    if (!fresh) {
      return yield* Effect.fail(notFound('Letter not found'));
    }

    return letterToApi(
      {
        id: fresh.id,
        space_id: fresh.space_id,
        author_user_id: fresh.author_user_id,
        caption: fresh.caption,
        body: fresh.body,
        sealed_until: fresh.sealed_until,
        created_at: fresh.created_at,
        opened_at: fresh.opened_at,
      },
      fresh.author_name,
      userId,
      at
    );
  });
