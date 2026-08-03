import type { SpaceActivityItem, SpaceActivityKind } from '@aoi/shared';

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

/** Convert DB row to API shape for moments */
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
    authorRole: string;
    authorName: string;
    mediaPreview: string | null;
    audioUri?: string | null;
  },
  viewerUserId: string
) {
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
    authorRole: row.authorRole as any,
    authorName: row.authorName,
    // Per-request ownership: only the requesting user's own moments are
    // editable/deletable on the client.
    isOwn: row.createdByUserId === viewerUserId,
    mediaPreview: row.mediaPreview,
    audioUri: row.audioUri ?? null,
  };
}

/** Convert DB row to API shape for calendar events */
export function calendarEventRowToApi(row: {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  actor: string;
  actorName: string;
  labelPreset: string;
  labelCustomText: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const label = row.labelPreset === 'Other' && row.labelCustomText
    ? { preset: 'Other' as const, customText: row.labelCustomText }
    : { preset: row.labelPreset as any };

  return {
    id: row.id,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    actor: row.actor as any,
    actorName: row.actorName,
    label,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
