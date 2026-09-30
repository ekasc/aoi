import type { Moment } from '@/features/moments/types';
import type { RelationshipSpace } from '@/features/space/types';

export type FirstPage =
  | { kind: 'quiet' }
  | { kind: 'dedication'; partnerName: string; waiting: boolean }
  | { kind: 'welcome'; momentId: string; authorName: string };

export function firstPageKey(viewerId: string, spaceId: string): string {
  return `aoi.first-page.v1.${encodeURIComponent(viewerId).replaceAll('.', '%2E')}.${encodeURIComponent(spaceId).replaceAll('.', '%2E')}`;
}

export function deriveFirstPage({ space, viewerId, moments, pendingCount, ready, dismissed }: {
  space: RelationshipSpace | null;
  viewerId: string | null;
  moments: Moment[];
  pendingCount: number;
  ready: boolean;
  dismissed: boolean;
}): FirstPage {
  if (!ready || dismissed || !space || !viewerId || pendingCount > 0) return { kind: 'quiet' };
  if (moments.length === 0) {
    return { kind: 'dedication', partnerName: space.partnerName?.trim() || 'you', waiting: !space.partnerJoined };
  }
  if (space.createdByUserId === viewerId || moments.some((moment) => moment.isOwn === true || moment.authorId === viewerId)) {
    return { kind: 'quiet' };
  }
  const welcome = moments.reduce<Moment | null>((latest, moment) => {
    if (moment.authorId !== space.createdByUserId) return latest;
    return !latest || moment.createdAt > latest.createdAt ? moment : latest;
  }, null);
  return welcome ? { kind: 'welcome', momentId: welcome.id, authorName: welcome.authorName } : { kind: 'quiet' };
}
