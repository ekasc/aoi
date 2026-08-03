import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, ne } from 'drizzle-orm';
import {
  WEEKLY_ANSWER_MAX_LENGTH,
  getWeeklyQuestionForDate,
  type WeeklyQuestionResponse,
} from '@aoi/shared';
import { db } from '../db/index.js';
import { spaceMembers, users, weeklyAnswers } from '../db/schema.js';
import { badRequest } from '../lib/errors.js';
import { weeklyAnswerRowToApi } from '../lib/db.js';
import { getActiveSpaceId } from '../lib/space.js';

const questionRouter = new Hono();

// All routes address the caller's own current space (resolved from their
// active membership), so there is no id-addressed surface where another
// space's resources could leak — cross-space access is impossible by
// construction (mirrors the /current routes in someday.ts).

// ── Helper: assemble the current-question response ───────────────────────
// The reveal gate lives here: the partner's answer content is only included
// when BOTH partners have answered this week. The partner's answer timing
// (updatedAt) is never surfaced — only the fact that they answered.

async function buildCurrentQuestionResponse(
  userId: string,
  spaceId: string | null,
  now: Date
): Promise<WeeklyQuestionResponse> {
  const week = getWeeklyQuestionForDate(now);

  if (!spaceId) {
    return {
      weekKey: week.weekKey,
      questionId: week.questionId,
      question: week.question,
      yourAnswer: null,
      yourAnswerUpdatedAt: null,
      partnerAnswered: false,
      partnerAnswer: null,
      partnerName: null,
      revealed: false,
    };
  }

  const rows = await db
    .select()
    .from(weeklyAnswers)
    .where(
      and(
        eq(weeklyAnswers.spaceId, spaceId),
        eq(weeklyAnswers.weekKey, week.weekKey)
      )
    );

  const yourRow = rows.find((row) => row.userId === userId) ?? null;
  const partnerRow = rows.find((row) => row.userId !== userId) ?? null;

  const [partnerMember] = await db
    .select({ displayName: users.displayName })
    .from(spaceMembers)
    .innerJoin(users, eq(spaceMembers.userId, users.id))
    .where(
      and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.state, 'active'),
        ne(spaceMembers.userId, userId)
      )
    )
    .limit(1);

  const revealed = yourRow !== null && partnerRow !== null;
  const yourAnswer = yourRow ? weeklyAnswerRowToApi(yourRow) : null;
  const partnerAnswer =
    revealed && partnerRow ? weeklyAnswerRowToApi(partnerRow) : null;

  return {
    weekKey: week.weekKey,
    questionId: week.questionId,
    question: week.question,
    yourAnswer: yourAnswer?.answer ?? null,
    yourAnswerUpdatedAt: yourAnswer?.updatedAt ?? null,
    partnerAnswered: partnerRow !== null,
    partnerAnswer: partnerAnswer?.answer ?? null,
    partnerName: partnerMember?.displayName ?? null,
    revealed,
  };
}

// ── Get the current question + both answer states ────────────────────────
// The question itself depends only on the ISO week, so a caller without a
// space still receives it with empty answer states (graceful empty, like the
// Someday list). Answer content is always gated on membership + the reveal.

questionRouter.get('/v1/spaces/current/question', async (c) => {
  const userId = c.var.userId;

  const spaceId = await getActiveSpaceId(userId);
  const now = new Date();

  return c.json(await buildCurrentQuestionResponse(userId, spaceId, now));
});

// ── Upsert your own answer for this week ─────────────────────────────────
// The week and question are decided server-side so a client can never write
// into the wrong week (or a fabricated one). Answer content is never logged.

const putWeeklyAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(WEEKLY_ANSWER_MAX_LENGTH),
});

questionRouter.put(
  '/v1/spaces/current/question/answer',
  zValidator('json', putWeeklyAnswerSchema),
  async (c) => {
    const userId = c.var.userId;

    const spaceId = await getActiveSpaceId(userId);
    if (!spaceId) {
      throw badRequest(
        "You must have an active space to answer this week's question"
      );
    }

    const now = new Date();
    const week = getWeeklyQuestionForDate(now);
    const { answer } = c.req.valid('json');

    await db
      .insert(weeklyAnswers)
      .values({
        spaceId,
        userId,
        weekKey: week.weekKey,
        questionId: week.questionId,
        answer,
      })
      .onConflictDoUpdate({
        target: [weeklyAnswers.spaceId, weeklyAnswers.userId, weeklyAnswers.weekKey],
        set: { answer, updatedAt: now },
      });

    return c.json(await buildCurrentQuestionResponse(userId, spaceId, now));
  }
);

export { questionRouter };
