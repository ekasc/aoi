import { Effect } from 'effect';

import {
  getWeeklyQuestionForDate,
  type PutWeeklyAnswerRequest,
  type WeeklyQuestionResponse,
} from '@aoi/shared';

import { nowMs, type ClockService } from '../effects/clock';
import { newId, type IdService } from '../effects/id';
import { Db, type DbService } from '../effects/d1';
import { getActiveSpaceId } from './spaces';
import { BadRequestError, InternalError, badRequest } from './errors';

/**
 * Question domain — the weekly question. The question itself depends only on
 * the ISO week, so a caller without a space still receives it with empty
 * answer states (graceful empty). Answer content is always gated on
 * membership + the reveal gate: the partner's answer is only included when
 * BOTH partners have answered this week. The partner's answer timing is
 * never surfaced — only the fact that they answered.
 */

export interface WeeklyAnswerRow {
  id: string;
  space_id: string;
  user_id: string;
  week_key: string;
  question_id: number;
  answer: string;
  created_at: number;
  updated_at: number;
}

/** Assemble the current-question response for one viewer. */
export function buildQuestionResponse(
  week: ReturnType<typeof getWeeklyQuestionForDate>,
  spaceId: string | null,
  userId: string,
  rows: WeeklyAnswerRow[],
  partnerName: string | null
): WeeklyQuestionResponse {
  const yourRow = rows.find((row) => row.user_id === userId) ?? null;
  const partnerRow = rows.find((row) => row.user_id !== userId) ?? null;
  const revealed = yourRow !== null && partnerRow !== null;

  return {
    weekKey: week.weekKey,
    questionId: week.questionId,
    question: week.question,
    yourAnswer: yourRow?.answer ?? null,
    yourAnswerUpdatedAt: yourRow === null ? null : new Date(yourRow.updated_at).toISOString(),
    partnerAnswered: partnerRow !== null,
    partnerAnswer: revealed && partnerRow ? partnerRow.answer : null,
    partnerName,
    revealed,
  };
}

// ── Get the current question + both answer states ────────────────────────

export const getQuestionProgram = (
  userId: string
): Effect.Effect<WeeklyQuestionResponse, InternalError, DbService | ClockService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    const at = yield* nowMs;
    const week = getWeeklyQuestionForDate(new Date(at));

    if (!spaceId) {
      return buildQuestionResponse(week, null, userId, [], null);
    }

    const db = yield* Db;
    const rows = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select id, space_id, user_id, week_key, question_id, answer,
                    created_at, updated_at
             from weekly_answers
             where space_id = ? and week_key = ?`
          )
          .bind(spaceId, week.weekKey)
          .all<WeeklyAnswerRow>(),
      catch: () => new InternalError({}),
    });

    const partnerName = yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `select u.name from space_members sm
             join users u on u.id = sm.user_id
             where sm.space_id = ? and sm.state = 'active' and sm.user_id <> ?
             limit 1`
          )
          .bind(spaceId, userId)
          .first<{ name: string }>(),
      catch: () => new InternalError({}),
    });

    return buildQuestionResponse(week, spaceId, userId, rows.results ?? [], partnerName?.name ?? null);
  });

// ── Upsert your own answer for this week ─────────────────────────────────
// The week and question are decided server-side so a client can never write
// into the wrong week (or a fabricated one). Answer content is never logged.

export const putAnswerProgram = (
  userId: string,
  input: PutWeeklyAnswerRequest
): Effect.Effect<WeeklyQuestionResponse, BadRequestError | InternalError, DbService | ClockService | IdService> =>
  Effect.gen(function* () {
    const spaceId = yield* getActiveSpaceId(userId);
    if (!spaceId) {
      return yield* Effect.fail(badRequest("You must have an active space to answer this week's question"));
    }

    const at = yield* nowMs;
    const week = getWeeklyQuestionForDate(new Date(at));
    const id = yield* newId;

    const db = yield* Db;
    yield* Effect.tryPromise({
      try: () =>
        db.d1
          .prepare(
            `insert into weekly_answers
               (id, space_id, user_id, week_key, question_id, answer, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, ?)
             on conflict (space_id, user_id, week_key) do update set
               answer = excluded.answer,
               updated_at = excluded.updated_at`
          )
          .bind(id, spaceId, userId, week.weekKey, week.questionId, input.answer, at, at)
          .run(),
      catch: () => new InternalError({}),
    });

    return yield* getQuestionProgram(userId);
  });
