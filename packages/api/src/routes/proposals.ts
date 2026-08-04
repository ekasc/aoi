import { Hono } from 'hono';
import { z, type ZodError } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc } from 'drizzle-orm';
import { PROPOSAL_TITLE_MAX_LENGTH } from '@aoi/shared';
import { db } from '../db/index.js';
import { calendarEvents, eventProposals, spaceMembers, users } from '../db/schema.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { proposalRowToApi } from '../lib/db.js';
import { getActiveSpaceId } from '../lib/space.js';
import { notifyPartnerInSpace } from '../lib/push.js';

const proposalsRouter = new Hono();

// Proposals: "how about Saturday?" One partner suggests a time; only the
// OTHER partner can accept or decline it, and only while it is still
// pending. Accepting copies the proposal into a real calendar event (actor =
// proposer). Every error below is a fixed word-only string — titles and
// times never echo back, and proposal pushes carry vague copy only.

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Surface zod failures as the house ApiError shape with the schema's own
 * word-only messages (never numbers, never echoed dates).
 */
function throwFirstIssue(result: { success: boolean; error?: ZodError }): void {
  if (result.success) {
    return;
  }
  const message = result.error?.issues[0]?.message ?? 'That suggestion is not quite ready';
  throw badRequest(message);
}

async function fetchProposal(proposalId: string) {
  const rows = await db
    .select()
    .from(eventProposals)
    .where(eq(eventProposals.id, proposalId))
    .limit(1);

  return rows[0] ?? null;
}

async function isSpaceMember(spaceId: string, userId: string): Promise<boolean> {
  const [membership] = await db
    .select()
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.userId, userId),
        eq(spaceMembers.state, 'active')
      )
    )
    .limit(1);

  return Boolean(membership);
}

// ── Propose a time ───────────────────────────────────────────────────────

const createProposalSchema = z.object({
  title: z
    .string({ required_error: 'Give the idea a few words' })
    .trim()
    .min(1, 'Give the idea a few words')
    .max(PROPOSAL_TITLE_MAX_LENGTH, 'Keep the suggestion short and sweet'),
  proposedStart: z.string({
    required_error: "That time doesn't look quite right",
  }).datetime({ offset: true, message: "That time doesn't look quite right" }),
  proposedEnd: z.string({
    required_error: "That time doesn't look quite right",
  }).datetime({ offset: true, message: "That time doesn't look quite right" }),
  label: z
    .object({
      preset: z.enum(['Work', 'Gym', 'Travel', 'Date', 'Family', 'Other']),
      customText: z.string().max(200).optional(),
    })
    .optional(),
});

proposalsRouter.post(
  '/v1/spaces/current/proposals',
  zValidator('json', createProposalSchema, (result) => throwFirstIssue(result)),
  async (c) => {
    const userId = c.var.userId;

    const spaceId = await getActiveSpaceId(userId);
    if (!spaceId) {
      throw badRequest('You must have an active space to suggest a time');
    }

    const input = c.req.valid('json');
    const now = new Date();
    const proposedStart = new Date(input.proposedStart);
    const proposedEnd = new Date(input.proposedEnd);

    // The suggestion must point strictly ahead…
    if (!(proposedStart.getTime() > now.getTime())) {
      throw badRequest('A suggestion can only point to the future');
    }

    // …and end after it begins (word-only declines, never echoing times).
    if (!(proposedEnd.getTime() > proposedStart.getTime())) {
      throw badRequest('The ending needs to come after the start');
    }

    const [created] = await db
      .insert(eventProposals)
      .values({
        spaceId,
        proposerUserId: userId,
        title: input.title,
        proposedStart,
        proposedEnd,
        label: input.label
          ? {
              preset: input.label.preset,
              ...(input.label.preset === 'Other' && input.label.customText
                ? { customText: input.label.customText }
                : {}),
            }
          : null,
        status: 'pending',
        createdAt: now,
        resolvedAt: null,
      })
      .returning();

    // The partner hears that something was suggested — never what, never
    // when. Fire-and-forget like letters: push must never stall the propose.
    void notifyPartnerInSpace(spaceId, userId, 'proposal_received');

    return c.json(
      proposalRowToApi({ ...created, proposerName: 'You' }, userId),
      201
    );
  }
);

// ── List the space's proposals ───────────────────────────────────────────
// Both partners see every proposal; authorship is computed relative to the
// viewer. Newest first.

proposalsRouter.get('/v1/spaces/current/proposals', async (c) => {
  const userId = c.var.userId;

  const spaceId = await getActiveSpaceId(userId);
  if (!spaceId) {
    return c.json({ proposals: [] });
  }

  const rows = await db
    .select({
      id: eventProposals.id,
      proposerUserId: eventProposals.proposerUserId,
      proposerName: users.displayName,
      title: eventProposals.title,
      proposedStart: eventProposals.proposedStart,
      proposedEnd: eventProposals.proposedEnd,
      label: eventProposals.label,
      status: eventProposals.status,
      createdAt: eventProposals.createdAt,
      resolvedAt: eventProposals.resolvedAt,
    })
    .from(eventProposals)
    .innerJoin(users, eq(eventProposals.proposerUserId, users.id))
    .where(eq(eventProposals.spaceId, spaceId))
    .orderBy(desc(eventProposals.createdAt), desc(eventProposals.id));

  return c.json({ proposals: rows.map((row) => proposalRowToApi(row, userId)) });
});

// ── Resolve (accept / decline) ───────────────────────────────────────────
// Shared guard chain: the proposal must exist, belong to a space the viewer
// is an active member of (another space's id is indistinguishable from no
// proposal at all), be the partner's (never your own), and still be pending.
// The actual transition is one atomic UPDATE … WHERE status = 'pending', so
// a double-resolve can never race: the first write wins, the second sees an
// already-answered proposal.

type ResolvedContext = {
  proposal: NonNullable<Awaited<ReturnType<typeof fetchProposal>>>;
  proposerName: string;
};

async function guardResolvable(proposalId: string, userId: string): Promise<ResolvedContext> {
  const proposal = await fetchProposal(proposalId);

  if (!proposal) {
    throw notFound('Proposal not found');
  }

  const member = await isSpaceMember(proposal.spaceId, userId);
  if (!member) {
    throw notFound('Proposal not found');
  }

  if (proposal.proposerUserId === userId) {
    // The proposer never answers their own suggestion.
    throw forbidden('This one is theirs to answer');
  }

  if (proposal.status !== 'pending') {
    throw badRequest('This one has already been answered');
  }

  // The proposer's name and membership role — needed for authorship on
  // accept, and for the response either way.
  const [proposer] = await db
    .select({ role: spaceMembers.role, displayName: users.displayName })
    .from(spaceMembers)
    .innerJoin(users, eq(spaceMembers.userId, users.id))
    .where(
      and(
        eq(spaceMembers.spaceId, proposal.spaceId),
        eq(spaceMembers.userId, proposal.proposerUserId)
      )
    )
    .limit(1);

  return { proposal, proposerName: proposer?.displayName ?? 'Your partner' };
}

function alreadyAnswered(message: string) {
  return badRequest(message);
}

proposalsRouter.post(
  '/v1/proposals/:id/accept',
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.var.userId;
    const proposalId = c.req.param('id');
    const now = new Date();

    const { proposal, proposerName } = await guardResolvable(proposalId, userId);

    // Atomic gate: the first accept wins; a concurrent second write matches
    // nothing.
    const [accepted] = await db
      .update(eventProposals)
      .set({ status: 'accepted', resolvedAt: now })
      .where(and(eq(eventProposals.id, proposalId), eq(eventProposals.status, 'pending')))
      .returning();

    if (!accepted) {
      // Answered between the check and the write — calm, no details.
      throw alreadyAnswered('This one has already been answered');
    }

    // The proposal becomes a real calendar event. Authorship stays with the
    // proposer (actor = proposer, created under their id) — the accept only
    // said yes. The proposer's membership role is the space's authorship
    // snapshot, exactly like moments.
    const [proposer] = await db
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.spaceId, proposal.spaceId),
          eq(spaceMembers.userId, proposal.proposerUserId),
          eq(spaceMembers.state, 'active')
        )
      )
      .limit(1);

    await db.insert(calendarEvents).values({
      spaceId: proposal.spaceId,
      createdByUserId: proposal.proposerUserId,
      actor: proposer?.role ?? 'partner',
      actorName: proposerName,
      title: proposal.title,
      startsAt: proposal.proposedStart,
      endsAt: proposal.proposedEnd,
      labelPreset:
        proposal.label && typeof proposal.label.preset === 'string'
          ? (proposal.label.preset as
              | 'Work'
              | 'Gym'
              | 'Travel'
              | 'Date'
              | 'Family'
              | 'Other')
          : 'Other',
      labelCustomText:
        proposal.label?.preset === 'Other' ? (proposal.label.customText ?? null) : null,
      reminderMinutesBefore: null,
      allDay: false,
      together: false,
      recurrence: 'none',
      recurrenceGroupId: null,
      createdAt: now,
      updatedAt: now,
    });

    // They said yes — vague copy only, never the title or the time.
    void notifyPartnerInSpace(proposal.spaceId, userId, 'proposal_accepted');

    return c.json(
      proposalRowToApi({ ...accepted, proposerName }, userId)
    );
  }
);

proposalsRouter.post(
  '/v1/proposals/:id/decline',
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.var.userId;
    const proposalId = c.req.param('id');
    const now = new Date();

    const { proposal, proposerName } = await guardResolvable(proposalId, userId);

    // Atomic gate: declining is just as one-way as accepting.
    const [declined] = await db
      .update(eventProposals)
      .set({ status: 'declined', resolvedAt: now })
      .where(and(eq(eventProposals.id, proposalId), eq(eventProposals.status, 'pending')))
      .returning();

    if (!declined) {
      throw alreadyAnswered('This one has already been answered');
    }

    // A gentle pass — vague copy only. "Not now" is always fine.
    void notifyPartnerInSpace(proposal.spaceId, userId, 'proposal_declined');

    return c.json(
      proposalRowToApi({ ...declined, proposerName }, userId)
    );
  }
);

export { proposalsRouter };
