import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';

import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import {
  createEventProgram,
  deleteEventProgram,
  getEventProgram,
  listEventsProgram,
  updateEventProgram,
} from '../../domains/calendar';
import {
  acceptProposalProgram,
  createProposalProgram,
  declineProposalProgram,
  listProposalsProgram,
} from '../../domains/proposals';
import {
  listLettersProgram,
  openLetterProgram,
  sealLetterProgram,
} from '../../domains/letters';
import { getQuestionProgram, putAnswerProgram } from '../../domains/question';
import {
  createSomedayProgram,
  listSomedayProgram,
  updateSomedayProgram,
} from '../../domains/someday';
import {
  getLocationProgram,
  requestLocationProgram,
  shareLocationProgram,
  stopSharingProgram,
  updateConsentProgram,
} from '../../domains/location';
import {
  getPreferencesProgram,
  updatePreferencesProgram,
} from '../../domains/preferences';
import {
  createMilestoneProgram,
  listMilestonesProgram,
} from '../../domains/milestones';
import { sendSqueezeProgram } from '../../domains/squeezes';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../domains/errors';

/**
 * Domain tests for the ported remaining domains — pinned at the program
 * level against the real D1 baseline (better-sqlite3 shim):
 * - calendar: range list, creator-only update/delete, weekly expansion into
 *   concrete instances;
 * - proposals: partner-only accept/decline, atomic accept → calendar event;
 * - letters: seal horizon, body lock, guarded one-way open;
 * - question: reveal gate (both answers before partner content);
 * - someday: membership gate, meaningful-only transitions;
 * - location: consent mutuality, freshness, one-time grant consumption;
 * - preferences / milestones / squeezes: basic flows.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const SPACE_1 = '00000000-0000-4000-8000-000000000010';

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    Date.parse('2026-01-01T00:00:00.000Z'),
    Date.parse('2026-01-01T00:00:00.000Z')
  );
}

function insertSpace(d1: ShimD1, id: string, creatorId: string, name = 'Our Space'): void {
  d1.runSync(
    `insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at)
     values (?, ?, 'Partner', '2026-01-01', ?, ?, ?)`,
    id,
    name,
    creatorId,
    Date.parse('2026-01-01T00:00:00.000Z'),
    Date.parse('2026-01-01T00:00:00.000Z')
  );
  insertMember(d1, id, creatorId, 'you');
}

function insertMember(d1: ShimD1, spaceId: string, userId: string, role: 'you' | 'partner'): void {
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, ?, 'active', ?)`,
    spaceId,
    userId,
    role,
    Date.parse('2026-01-01T00:00:00.000Z')
  );
}

function insertCalendarEvent(
  d1: ShimD1,
  id: string,
  spaceId: string,
  creatorId: string,
  startsAtMs: number,
  endsAtMs: number,
  title = 'Dinner'
): void {
  d1.runSync(
    `insert into calendar_events
       (id, space_id, created_by_user_id, actor, actor_name, title,
        starts_at, ends_at, label_preset, label_custom_text,
        reminder_minutes_before, all_day, together, recurrence,
        recurrence_group_id, created_at, updated_at)
     values (?, ?, ?, 'you', 'You', ?, ?, ?, 'Other', null, null, 0, 0, 'none', null, ?, ?)`,
    id,
    spaceId,
    creatorId,
    title,
    startsAtMs,
    endsAtMs,
    startsAtMs,
    startsAtMs
  );
}

function insertProposal(
  d1: ShimD1,
  id: string,
  spaceId: string,
  proposerId: string,
  startMs: number,
  endMs: number,
  status = 'pending',
  labelJson: string | null = null
): void {
  d1.runSync(
    `insert into event_proposals
       (id, space_id, proposer_user_id, title, proposed_start, proposed_end,
        label, status, created_at, resolved_at)
     values (?, ?, ?, 'Dinner?', ?, ?, ?, ?, ?, null)`,
    id,
    spaceId,
    proposerId,
    startMs,
    endMs,
    labelJson,
    status,
    startMs
  );
}

function insertLetter(
  d1: ShimD1,
  id: string,
  spaceId: string,
  authorId: string,
  sealedUntilMs: number
): void {
  d1.runSync(
    `insert into letters
       (id, space_id, author_user_id, caption, body, sealed_until, created_at)
     values (?, ?, ?, null, 'secret body', ?, ?)`,
    id,
    spaceId,
    authorId,
    sealedUntilMs,
    Date.parse('2026-01-01T00:00:00.000Z')
  );
}

function insertAnswer(
  d1: ShimD1,
  id: string,
  spaceId: string,
  userId: string,
  weekKey: string,
  answer: string
): void {
  d1.runSync(
    `insert into weekly_answers (id, space_id, user_id, week_key, question_id, answer, created_at, updated_at)
     values (?, ?, ?, ?, 0, ?, ?, ?)`,
    id,
    spaceId,
    userId,
    weekKey,
    answer,
    Date.parse('2026-01-01T00:00:00.000Z'),
    Date.parse('2026-01-01T00:00:00.000Z')
  );
}

function makeCtx() {
  const harness = makeTestHarness();
  return {
    harness,
    provide: <A, E, R>(program: Effect.Effect<A, E, R>) =>
      Effect.provide(program as Effect.Effect<A, E, never>, harness.layer as never) as Effect.Effect<A, E, never>,
  };
}

function run<A>(effect: Effect.Effect<A, unknown, never>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, unknown, never>);
}

async function failureOf<A>(effect: Effect.Effect<A, unknown, never>): Promise<unknown> {
  const exit = await Effect.runPromise(Effect.exit(effect as Effect.Effect<A, unknown, never>));
  if (Exit.isSuccess(exit)) {
    throw new Error('expected program to fail, but it succeeded');
  }
  const cause = exit.cause as { _tag: string; error?: unknown };
  if (cause._tag === 'Fail' && cause.error !== undefined) {
    return cause.error;
  }
  throw new Error(`unexpected failure cause: ${cause._tag}`);
}

/** True when the queue captured a push.deliver job of the given kind. */
function hasPushKind(queue: readonly { type: string; kind?: string }[], kind: string): boolean {
  return queue.some((job) => job.type === 'push.deliver' && job.kind === kind);
}


const JAN_1 = Date.parse('2026-01-01T00:00:00.000Z');
const JAN_2 = Date.parse('2026-01-02T00:00:00.000Z');
const JAN_3 = Date.parse('2026-01-03T00:00:00.000Z');
const JAN_10 = Date.parse('2026-01-10T00:00:00.000Z');
// The harness clock starts at 2026-01-15T00:00:00Z — future-facing dates
// for proposals (must point ahead of now) and letters (seal + open gates).
const FEB_1 = Date.parse('2026-02-01T00:00:00.000Z');
const FEB_2 = Date.parse('2026-02-02T00:00:00.000Z');
const MAR_1 = Date.parse('2026-03-01T00:00:00.000Z');

// ── Calendar ─────────────────────────────────────────────────────────────

describe('calendar domain', () => {
  it('lists events in a half-open window for the active space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertCalendarEvent(ctx.harness.d1, '00000000-0000-4000-8000-000000000021', SPACE_1, USER_A, JAN_1, JAN_2);
    insertCalendarEvent(ctx.harness.d1, '00000000-0000-4000-8000-000000000022', SPACE_1, USER_B, JAN_3, JAN_10);

    const events = await run(ctx.provide(listEventsProgram(USER_A, { from: new Date(JAN_1 - 1).toISOString(), to: new Date(JAN_10 - 1).toISOString() })));
    expect(events).toHaveLength(2);
    expect(events[0].isOwn).toBe(true);
    expect(events[1].isOwn).toBe(false);
  });

  it('returns an empty list without an active space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Casey');
    const events = await run(ctx.provide(listEventsProgram(USER_C, { from: new Date(JAN_1).toISOString(), to: new Date(JAN_10).toISOString() })));
    expect(events).toEqual([]);
  });

  it('create + weekly expansion produces bounded concrete instances', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);

    const created = await run(
      ctx.provide(
        createEventProgram(USER_A, {
          title: 'Gym',
          startsAt: new Date(JAN_1).toISOString(),
          endsAt: new Date(JAN_1 + 3600_000).toISOString(),
          actor: 'you',
          actorName: 'Alice',
          label: { preset: 'Gym' },
          recurrence: 'weekly',
        })
      )
    );
    expect(created.recurrence).toBe('weekly');

    const rows = ctx.harness.d1.rawDb
      .prepare('select count(*) as n from calendar_events where space_id = ? and deleted_at is null')
      .get(SPACE_1) as { n: number };
    expect(rows.n).toBe(13);
    // Push enqueued once for the create.
    expect(hasPushKind(ctx.harness.capturedQueue, 'event_added')).toBe(true);
  });

  it('update is creator-only and validates the merged range', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertCalendarEvent(ctx.harness.d1, '00000000-0000-4000-8000-000000000021', SPACE_1, USER_A, JAN_1, JAN_2);

    const fail1 = await failureOf(ctx.provide(updateEventProgram(USER_B, '00000000-0000-4000-8000-000000000021', { title: 'Nope' })));
    expect(fail1).toBeInstanceOf(ForbiddenError);

    const fail2 = await failureOf(
      ctx.provide(updateEventProgram(USER_A, '00000000-0000-4000-8000-000000000021', { endsAt: new Date(JAN_1).toISOString() }))
    );
    expect(fail2).toBeInstanceOf(BadRequestError);

    const updated = await run(
      ctx.provide(updateEventProgram(USER_A, '00000000-0000-4000-8000-000000000021', { title: 'Lunch', together: true }))
    );
    expect(updated.title).toBe('Lunch');
    expect(updated.together).toBe(true);
    expect(hasPushKind(ctx.harness.capturedQueue, 'event_updated')).toBe(true);
  });

  it('delete is creator-only and soft; non-members get 404', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Casey');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertCalendarEvent(ctx.harness.d1, '00000000-0000-4000-8000-000000000021', SPACE_1, USER_A, JAN_1, JAN_2);

    const fail1 = await failureOf(ctx.provide(deleteEventProgram(USER_B, '00000000-0000-4000-8000-000000000021')));
    expect(fail1).toBeInstanceOf(ForbiddenError);

    const fail2 = await failureOf(ctx.provide(deleteEventProgram(USER_C, '00000000-0000-4000-8000-000000000021')));
    expect(fail2).toBeInstanceOf(NotFoundError);

    await run(ctx.provide(deleteEventProgram(USER_A, '00000000-0000-4000-8000-000000000021')));
    const events = await run(ctx.provide(listEventsProgram(USER_A, { from: new Date(JAN_1 - 1).toISOString(), to: new Date(JAN_2 + 1).toISOString() })));
    expect(events).toHaveLength(0);
    expect(hasPushKind(ctx.harness.capturedQueue, 'event_deleted')).toBe(true);
  });
});

// ── Proposals ────────────────────────────────────────────────────────────

describe('proposals domain', () => {
  it('create + list with viewer-relative authorship', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');

    const created = await run(
      ctx.provide(
        createProposalProgram(USER_A, {
          title: 'Dinner?',
          proposedStart: new Date(FEB_1).toISOString(),
          proposedEnd: new Date(FEB_1 + 3600_000).toISOString(),
        })
      )
    );
    expect(created.proposerRole).toBe('you');
    expect(hasPushKind(ctx.harness.capturedQueue, 'proposal_received')).toBe(true);

    const listA = await run(ctx.provide(listProposalsProgram(USER_A)));
    expect(listA).toHaveLength(1);
    expect(listA[0].proposerRole).toBe('you');

    const listB = await run(ctx.provide(listProposalsProgram(USER_B)));
    expect(listB[0].proposerRole).toBe('partner');
  });

  it('rejects a proposal that is not in the future or ends before it starts', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);

    const failPast = await failureOf(
      ctx.provide(
        createProposalProgram(USER_A, {
          title: 'Dinner?',
          proposedStart: new Date(JAN_1).toISOString(),
          proposedEnd: new Date(JAN_1 + 3600_000).toISOString(),
        })
      )
    );
    expect(failPast).toBeInstanceOf(BadRequestError);

    const failOrder = await failureOf(
      ctx.provide(
        createProposalProgram(USER_A, {
          title: 'Dinner?',
          proposedStart: new Date(FEB_1).toISOString(),
          proposedEnd: new Date(JAN_3).toISOString(),
        })
      )
    );
    expect(failOrder).toBeInstanceOf(BadRequestError);
  });

  it('accept is partner-only and atomically creates a calendar event', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertProposal(ctx.harness.d1, '00000000-0000-4000-8000-000000000031', SPACE_1, USER_A, FEB_1, FEB_1 + 3600_000, 'pending', JSON.stringify({ preset: 'Date' }));

    // The proposer can never answer their own suggestion.
    const failOwn = await failureOf(ctx.provide(acceptProposalProgram(USER_A, '00000000-0000-4000-8000-000000000031')));
    expect(failOwn).toBeInstanceOf(ForbiddenError);

    const accepted = await run(ctx.provide(acceptProposalProgram(USER_B, '00000000-0000-4000-8000-000000000031')));
    expect(accepted.status).toBe('accepted');
    expect(hasPushKind(ctx.harness.capturedQueue, 'proposal_accepted')).toBe(true);

    // The calendar event was created in the same atomic batch.
    const events = ctx.harness.d1.rawDb
      .prepare('select count(*) as n from calendar_events where space_id = ? and deleted_at is null')
      .get(SPACE_1) as { n: number };
    expect(events.n).toBe(1);
    const eventRow = ctx.harness.d1.rawDb
      .prepare('select title, label_preset, label_custom_text from calendar_events where space_id = ? limit 1')
      .get(SPACE_1) as { title: string; label_preset: string; label_custom_text: string | null };
    expect(eventRow.title).toBe('Dinner?');
    // The proposal's label carries into the accepted event.
    expect(eventRow.label_preset).toBe('Date');
    expect(eventRow.label_custom_text).toBeNull();

    // A second accept is a calm already-answered.
    const failAgain = await failureOf(ctx.provide(acceptProposalProgram(USER_B, '00000000-0000-4000-8000-000000000031')));
    expect(failAgain).toBeInstanceOf(BadRequestError);
  });

  it('decline is partner-only and guarded', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertProposal(ctx.harness.d1, '00000000-0000-4000-8000-000000000032', SPACE_1, USER_A, FEB_1, FEB_1 + 3600_000);

    const declined = await run(ctx.provide(declineProposalProgram(USER_B, '00000000-0000-4000-8000-000000000032')));
    expect(declined.status).toBe('declined');
    expect(hasPushKind(ctx.harness.capturedQueue, 'proposal_declined')).toBe(true);

    // No calendar event was created for a decline.
    const events = ctx.harness.d1.rawDb
      .prepare('select count(*) as n from calendar_events where space_id = ? and deleted_at is null')
      .get(SPACE_1) as { n: number };
    expect(events.n).toBe(0);
  });
});

// ── Letters ──────────────────────────────────────────────────────────────

describe('letters domain', () => {
  it('seal enforces future + horizon; response omits the body', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);

    const failPast = await failureOf(
      ctx.provide(sealLetterProgram(USER_A, { body: 'hi', sealedUntil: new Date(JAN_1).toISOString() }))
    );
    expect(failPast).toBeInstanceOf(BadRequestError);

    const sealed = await run(
      ctx.provide(
        sealLetterProgram(USER_A, {
          body: 'secret body',
          caption: 'open me',
          sealedUntil: new Date(MAR_1).toISOString(),
        })
      )
    );
    expect(sealed.body).toBeUndefined();
    expect(sealed.isOpened).toBe(false);
    expect(sealed.readyToOpen).toBe(false);
    expect(hasPushKind(ctx.harness.capturedQueue, 'letter_sealed')).toBe(true);
  });

  it('list never leaks an unopened body; open is a guarded one-way transition', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    insertLetter(ctx.harness.d1, '00000000-0000-4000-8000-000000000041', SPACE_1, USER_A, MAR_1);

    const list = await run(ctx.provide(listLettersProgram(USER_B)));
    expect(list).toHaveLength(1);
    expect(list[0].body).toBeUndefined();
    expect(list[0].authorRole).toBe('partner');

    // Not yet time.
    const failEarly = await failureOf(ctx.provide(openLetterProgram(USER_B, '00000000-0000-4000-8000-000000000041')));
    expect(failEarly).toBeInstanceOf(BadRequestError);

    // Advance the clock past the seal and open.
    ctx.harness.clock.set(MAR_1 + 1);
    const opened = await run(ctx.provide(openLetterProgram(USER_B, '00000000-0000-4000-8000-000000000041')));
    expect(opened.body).toBe('secret body');
    expect(opened.isOpened).toBe(true);
    expect(opened.readyToOpen).toBe(true);

    // Idempotent re-open.
    const again = await run(ctx.provide(openLetterProgram(USER_B, '00000000-0000-4000-8000-000000000041')));
    expect(again.body).toBe('secret body');
  });

  it('a letter from another space is indistinguishable from none (404)', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Casey');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    // USER_C has no membership anywhere.
    insertLetter(ctx.harness.d1, '00000000-0000-4000-8000-000000000042', SPACE_1, USER_A, JAN_1);

    const fail = await failureOf(ctx.provide(openLetterProgram(USER_C, '00000000-0000-4000-8000-000000000042')));
    expect(fail).toBeInstanceOf(NotFoundError);
  });
});

// ── Question ─────────────────────────────────────────────────────────────

describe('question domain', () => {
  it('reveal gate: partner answer only after both have answered', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');

    const initial = await run(ctx.provide(getQuestionProgram(USER_A)));
    expect(initial.partnerAnswered).toBe(false);
    expect(initial.revealed).toBe(false);

    const answered = await run(ctx.provide(putAnswerProgram(USER_A, { answer: 'their laugh' })));
    expect(answered.yourAnswer).toBe('their laugh');
    expect(answered.partnerAnswer).toBe(null);
    expect(answered.revealed).toBe(false);

    const partner = await run(ctx.provide(putAnswerProgram(USER_B, { answer: 'a quiet walk' })));
    expect(partner.revealed).toBe(true);
    expect(partner.partnerAnswer).toBe('their laugh');

    const viewer = await run(ctx.provide(getQuestionProgram(USER_A)));
    expect(viewer.revealed).toBe(true);
    expect(viewer.partnerAnswer).toBe('a quiet walk');
    expect(viewer.yourAnswer).toBe('their laugh');
  });
});

// ── Someday ──────────────────────────────────────────────────────────────

describe('someday domain', () => {
  it('create/list/check-off with canonical ordering', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');

    const created = await run(
      ctx.provide(createSomedayProgram(USER_A, { title: 'Kyoto', category: 'place' }))
    );
    expect(created.createdByRole).toBe('you');

    const checked = await run(
      ctx.provide(updateSomedayProgram(USER_B, created.id, { checked: true }))
    );
    expect(checked.checkedAt).not.toBeNull();
    expect(checked.checkedByRole).toBe('you'); // viewer-relative: USER_B checked it

    const viewerA = await run(ctx.provide(updateSomedayProgram(USER_A, created.id, { checked: true })));
    expect(viewerA.checkedByRole).toBe('partner'); // USER_B checked it

    const list = await run(ctx.provide(listSomedayProgram(USER_A)));
    expect(list).toHaveLength(1);
    expect(list[0].checkedAt).not.toBeNull();
  });

  it('membership gate: another space item is a 404', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Casey');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);

    const created = await run(
      ctx.provide(createSomedayProgram(USER_A, { title: 'Kyoto', category: 'place' }))
    );
    const fail = await failureOf(ctx.provide(updateSomedayProgram(USER_C, created.id, { checked: true })));
    expect(fail).toBeInstanceOf(NotFoundError);
  });
});

// ── Location ─────────────────────────────────────────────────────────────

describe('location domain', () => {
  function consentBoth(ctx: { harness: ReturnType<typeof makeTestHarness> }) {
    const d1 = ctx.harness.d1;
    d1.runSync(
      `update space_members set location_consent_at = ? where space_id = ? and user_id = ?`,
      JAN_1,
      SPACE_1,
      USER_A
    );
    d1.runSync(
      `update space_members set location_consent_at = ? where space_id = ? and user_id = ?`,
      JAN_1,
      SPACE_1,
      USER_B
    );
  }

  it('sharing requires BOTH partners to consent', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');

    const fail = await failureOf(
      ctx.provide(shareLocationProgram(USER_A, { mode: 'live', latitude: 1, longitude: 2 }))
    );
    expect(fail).toBeInstanceOf(ForbiddenError);

    const consent = await run(ctx.provide(updateConsentProgram(USER_A, { consented: true })));
    expect(consent.youConsented).toBe(true);
    expect(consent.partnerConsented).toBe(false);

    // Still fails: partner has not consented.
    const fail2 = await failureOf(
      ctx.provide(shareLocationProgram(USER_A, { mode: 'live', latitude: 1, longitude: 2 }))
    );
    expect(fail2).toBeInstanceOf(ForbiddenError);
  });

  it("serves only a fresh partner share, never the caller's own", async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    consentBoth(ctx);

    await run(
      ctx.provide(shareLocationProgram(USER_B, { mode: 'live', latitude: 40.7, longitude: -74.0, accuracyMeters: 12 }))
    );
    expect(hasPushKind(ctx.harness.capturedQueue, 'location_granted')).toBe(false);

    const response = await run(ctx.provide(getLocationProgram(USER_A)));
    expect(response.location).not.toBeNull();
    expect(response.location!.latitude).toBe(40.7);
    expect(response.location!.mode).toBe('live');

    // The caller's own share is never returned.
    await run(
      ctx.provide(shareLocationProgram(USER_A, { mode: 'live', latitude: 1, longitude: 1 }))
    );
    const self = await run(ctx.provide(getLocationProgram(USER_A)));
    expect(self.location!.latitude).toBe(40.7); // still the partner's

    // Advance past freshness → purged, calm null.
    ctx.harness.clock.advance(16 * 60_000);
    const stale = await run(ctx.provide(getLocationProgram(USER_A)));
    expect(stale.location).toBeNull();
  });

  it('one-time grants are consumed exactly once', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    consentBoth(ctx);

    await run(
      ctx.provide(shareLocationProgram(USER_B, { mode: 'on_request_granted', latitude: 1, longitude: 2 }))
    );
    expect(hasPushKind(ctx.harness.capturedQueue, 'location_granted')).toBe(true);

    const first = await run(ctx.provide(getLocationProgram(USER_A)));
    expect(first.location).not.toBeNull();

    const second = await run(ctx.provide(getLocationProgram(USER_A)));
    expect(second.location).toBeNull();
  });

  it('request requires mutuality and stop is idempotent', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');

    // No consent → cannot ask.
    const fail = await failureOf(ctx.provide(requestLocationProgram(USER_A)));
    expect(fail).toBeInstanceOf(ForbiddenError);

    consentBoth(ctx);
    await run(ctx.provide(requestLocationProgram(USER_A)));
    expect(hasPushKind(ctx.harness.capturedQueue, 'location_request')).toBe(true);

    // Stop is idempotent (nothing to stop → still ok).
    const stopped = await run(ctx.provide(stopSharingProgram(USER_A)));
    expect(stopped).toEqual({ ok: true });
    const stopped2 = await run(ctx.provide(stopSharingProgram(USER_A)));
    expect(stopped2).toEqual({ ok: true });
  });

  it('revoking consent deletes the share row', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);
    insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
    consentBoth(ctx);

    await run(ctx.provide(shareLocationProgram(USER_A, { mode: 'live', latitude: 1, longitude: 2 })));
    const before = ctx.harness.d1.rawDb
      .prepare('select count(*) as n from location_shares where user_id = ?')
      .get(USER_A) as { n: number };
    expect(before.n).toBe(1);

    await run(ctx.provide(updateConsentProgram(USER_A, { consented: false })));
    const after = ctx.harness.d1.rawDb
      .prepare('select count(*) as n from location_shares where user_id = ?')
      .get(USER_A) as { n: number };
    expect(after.n).toBe(0);
    expect(hasPushKind(ctx.harness.capturedQueue, 'location_stopped')).toBe(true);
  });
});

// ── Preferences / Milestones / Squeezes ─────────────────────────────────

describe('preferences domain', () => {
  it('returns defaults then upserts', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');

    const initial = await run(ctx.provide(getPreferencesProgram(USER_A)));
    expect(initial.themeId).toBe('sunset-shore');

    const updated = await run(ctx.provide(updatePreferencesProgram(USER_A, { themeId: 'sea-glass' })));
    expect(updated.themeId).toBe('sea-glass');

    const again = await run(ctx.provide(getPreferencesProgram(USER_A)));
    expect(again.themeId).toBe('sea-glass');
  });
});

describe('milestones domain', () => {
  it('creates and lists imported milestones newest-first', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
    insertSpace(ctx.harness.d1, SPACE_1, USER_A);

    const m1 = await run(
      ctx.provide(
        createMilestoneProgram(USER_A, {
          type: 'milestone',
          title: 'First trip',
          occurredAt: new Date(JAN_1).toISOString(),
        })
      )
    );
    const m2 = await run(
      ctx.provide(
        createMilestoneProgram(USER_A, {
          type: 'date',
          title: 'Anniversary',
          occurredAt: new Date(JAN_2).toISOString(),
          body: 'A quiet dinner',
        })
      )
    );
    expect(m1.title).toBe('First trip');
    expect(m2.body).toBe('A quiet dinner');

    const list = await run(ctx.provide(listMilestonesProgram(USER_A)));
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe('Anniversary'); // newest first
  });
});

describe('squeezes domain', () => {
  it('enqueues a wordless push; requires a space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Casey');

    const fail = await failureOf(ctx.provide(sendSqueezeProgram(USER_C)));
    expect(fail).toBeInstanceOf(BadRequestError);

    insertSpace(ctx.harness.d1, SPACE_1, USER_C);
    const ok = await run(ctx.provide(sendSqueezeProgram(USER_C)));
    expect(ok).toEqual({ ok: true });
    expect(hasPushKind(ctx.harness.capturedQueue, 'squeeze')).toBe(true);
  });
});
