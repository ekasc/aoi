export type SpaceActivityKind = 'moment_deleted' | 'moment_edited';

/**
 * A single change-log entry for a space. Privacy rule: activity items only
 * ever carry the fact + the actor — never subject content (no titles,
 * bodies, or media).
 */
export type SpaceActivityItem = {
  id: string;
  kind: SpaceActivityKind;
  actorName: string;
  occurredAt: string;
};

export type SpaceActivityResponse = {
  activity: SpaceActivityItem[];
};
