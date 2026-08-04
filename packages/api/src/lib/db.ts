import type {
  CalendarEventRecurrence,
  CalendarPresetLabel,
  EventProposal,
  LocationShareDestination,
  LocationShareMode,
  PartnerLocationShare,
  ProposalProposerRole,
  ProposalStatus,
  SomedayAuthorRole,
  SomedayCategory,
  SomedayItem,
  SpaceActivityItem,
  SpaceActivityKind,
  Letter,
  LetterAuthorRole,} from '@aoi/shared';

/** Convert DB row to API shape for space activity (fact + actor only — never content) */
export function activityRowToApi(row: {
  id: string;
  kind: string;
  actorName: string;
  occurredAt: Date;
}): SpaceActivityItem {
  return {
    id: row.id,
    kind: row.kind as SpaceActivityKind,
    actorName: row.actorName,
    occurredAt: row.occurredAt.toISOString(),
  };
}

/**
 * Convert DB row to API shape for moments.
 *
 * Attribution is computed relative to the viewing user (author id vs viewer
 * id) — the stored `author_role` column is a creation-time snapshot and is
 * never read. `authorName` must carry the author's current display name
 * (read routes join it from users).
 */
export function momentRowToApi(
  row: {
    id: string;
    type: string;
    title: string;
    body: string;
    occurredAt: Date;
    targetAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    createdByUserId: string;
    authorName: string;
    mediaPreview: string | null;
    audioUri?: string | null;
  },
  viewerUserId: string
) {
  // Per-request ownership: only the requesting user's own moments are
  // editable/deletable on the client.
  const isOwn = row.createdByUserId === viewerUserId;
  return {
    id: row.id,
    type: row.type as any,
    title: row.title,
    body: row.body,
    occurredAt: row.occurredAt.toISOString(),
    targetAt: row.targetAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    authorId: row.createdByUserId,
    // The author is always either the viewer or their partner — compute it
    // from ids instead of trusting the stored role snapshot.
    authorRole: isOwn ? 'you' : 'partner',
    authorName: isOwn ? 'You' : row.authorName,
    isOwn,
    mediaPreview: row.mediaPreview,
    audioUri: row.audioUri ?? null,
  };
}

/** Convert DB row to API shape for calendar events */
export function calendarEventRowToApi(
  row: {
    id: string;
    createdByUserId: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    actor: string;
    actorName: string;
    labelPreset: string;
    labelCustomText: string | null;
    reminderMinutesBefore?: number[] | null;
    allDay?: boolean;
    together?: boolean;
    recurrence?: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  viewerUserId: string
) {
  const label = row.labelPreset === 'Other' && row.labelCustomText
    ? { preset: 'Other' as const, customText: row.labelCustomText }
    : { preset: row.labelPreset as any };

  const reminderMinutesBefore =
    Array.isArray(row.reminderMinutesBefore) && row.reminderMinutesBefore.length > 0
      ? row.reminderMinutesBefore
      : undefined;

  const recurrence: CalendarEventRecurrence =
    row.recurrence === 'weekly' ? 'weekly' : 'none';

  return {
    id: row.id,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    actor: row.actor as any,
    actorName: row.actorName,
    label,
    reminderMinutesBefore,
    allDay: row.allDay ?? false,
    together: row.together ?? false,
    recurrence,
    // Per-request ownership: only the requesting user's own events are
    // editable/deletable on the client (actor alone can't say — a user can
    // create an event "about" their partner).
    isOwn: row.createdByUserId === viewerUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Convert an event-proposal DB row to its API shape. Authorship
 * (`proposerRole`) is computed per request from the proposer's user id
 * relative to the viewer — the two people in a space are always either "you"
 * or "partner". The label jsonb is passed through only when it carries a
 * preset.
 */
export function proposalRowToApi(
  row: {
    id: string;
    proposerUserId: string;
    proposerName: string;
    title: string;
    proposedStart: Date;
    proposedEnd: Date;
    label: { preset: string; customText?: string } | null;
    status: string;
    createdAt: Date;
    resolvedAt: Date | null;
  },
  viewerUserId: string
): EventProposal {
  const isOwn = row.proposerUserId === viewerUserId;
  const proposerRole: ProposalProposerRole = isOwn ? 'you' : 'partner';

  const proposal: EventProposal = {
    id: row.id,
    proposerRole,
    proposerName: isOwn ? 'You' : row.proposerName,
    title: row.title,
    proposedStart: row.proposedStart.toISOString(),
    proposedEnd: row.proposedEnd.toISOString(),
    status: row.status as ProposalStatus,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };

  if (row.label && typeof row.label.preset === 'string') {
    proposal.label =
      row.label.preset === 'Other' && row.label.customText
        ? { preset: 'Other', customText: row.label.customText }
        : { preset: row.label.preset as CalendarPresetLabel };
  }

  return proposal;
}

/**
 * Convert DB row to API shape for someday items.
 *
 * Authorship (`createdByRole`, `checkedByRole`) is computed per request from
 * user ids relative to the viewer — the two people in a space are always
 * either "you" or "partner".
 */
export function somedayItemRowToApi(
  row: {
    id: string;
    title: string;
    note: string | null;
    category: string;
    createdByUserId: string;
    createdAt: Date;
    checkedAt: Date | null;
    checkedByUserId: string | null;
  },
  viewerUserId: string
): SomedayItem {
  const createdByRole: SomedayAuthorRole =
    row.createdByUserId === viewerUserId ? 'you' : 'partner';
  const checkedByRole: SomedayAuthorRole | null =
    row.checkedAt === null || row.checkedByUserId === null
      ? null
      : row.checkedByUserId === viewerUserId
        ? 'you'
        : 'partner';

  return {
    id: row.id,
    title: row.title,
    note: row.note ?? undefined,
    category: row.category as SomedayCategory,
    createdByRole,
    createdAt: row.createdAt.toISOString(),
    checkedAt: row.checkedAt?.toISOString() ?? null,
    checkedByRole,
  };
}

/**
 * Convert a weekly-answer DB row to its API shape. The reveal gate (partner
 * answers stay hidden until both partners have answered) is applied in the
 * route, never here — this serializer only normalizes one row.
 */
export function weeklyAnswerRowToApi(row: {
  answer: string;
  updatedAt: Date;
}): { answer: string; updatedAt: string } {
  return {
    answer: row.answer,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Convert a location-share DB row to the partner-facing API shape.
 *
 * Privacy note: this serializer is the ONLY place a stored position becomes
 * an API response, and it is always invoked behind the both-consent +
 * freshness gates in the location route. It never logs anything.
 */
export function locationShareRowToApi(row: {
  mode: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  reportedAt: Date;
  destination: LocationShareDestination | null;
}): PartnerLocationShare {
  return {
    mode: row.mode as LocationShareMode,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracyMeters,
    reportedAt: row.reportedAt.toISOString(),
    destination: row.destination ?? null,
  };
}

/**
 * Convert a letter DB row to its API shape. THE LOCK lives here: the body
 * only ever leaves the server once the letter has been opened — for the
 * partner and the author alike. Unopened letters are serialized without a
 * `body` key at all, on every read path. Authorship is computed per request
 * from user ids relative to the viewer, like every other shared surface.
 */
export function letterRowToApi(
  row: {
    id: string;
    authorUserId: string;
    authorName: string;
    caption: string | null;
    body: string;
    sealedUntil: Date;
    createdAt: Date;
    openedAt: Date | null;
  },
  viewerUserId: string,
  now: Date
): Letter {
  const isOwn = row.authorUserId === viewerUserId;
  const isOpened = row.openedAt !== null;
  const authorRole: LetterAuthorRole = isOwn ? 'you' : 'partner';

  const letter: Letter = {
    id: row.id,
    authorRole,
    authorName: isOwn ? 'You' : row.authorName,
    caption: row.caption,
    sealedUntil: row.sealedUntil.toISOString(),
    createdAt: row.createdAt.toISOString(),
    isOpened,
    readyToOpen: now.getTime() >= row.sealedUntil.getTime(),
    openedAt: row.openedAt?.toISOString() ?? null,
  };

  if (isOpened) {
    letter.body = row.body;
  }

  return letter;
}

/** Convert DB row to API shape for users */
export function userRowToApi(row: {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    email: row.email ?? '',
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Convert DB row to API shape for spaces */
export function spaceRowToApi(row: {
  id: string;
  name: string;
  relationshipStartDate: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    createdByUserId: row.createdByUserId,
    relationshipStartDate: row.relationshipStartDate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
