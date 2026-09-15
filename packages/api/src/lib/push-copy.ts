import type { PushNotificationKind } from '@aoi/shared';

/**
 * Warm, vague copy per kind — NEVER content. A push must tell the partner
 * that something happened, never what was written. Location pushes carry a
 * kind + a name at most — NEVER coordinates. `fromName` is only used by the
 * location kinds; everything else ignores it.
 *
 * Calendar/proposal pushes are deliberately vague: a partner reminder says
 * "they planned something", never the event title, and may carry at most the
 * DAY OF WEEK (`dayOfWeek`) — never a date, time, or detail. Proposal pushes
 * never carry the proposed title or time at all.
 *
 * Pure module (zero imports): the single copy source for BOTH the legacy
 * in-request delivery (`lib/push.ts`, which re-exports this) and the worker
 * queue consumer (`programs/queue-consumer.ts`). Copy is pinned verbatim by
 * tests.
 */
export function buildPushCopy(
  kind: PushNotificationKind,
  fromName?: string,
  dayOfWeek?: string
): { title: string; body: string } {
  switch (kind) {
    case 'squeeze':
      return { title: 'A squeeze for you', body: 'Your partner is thinking of you.' };
    case 'moment_added':
      return { title: 'They kept a moment', body: 'Something new landed in your space.' };
    case 'moment_edited':
      return { title: 'A moment changed', body: 'Your partner touched up something they kept.' };
    case 'moment_deleted':
      return { title: 'A moment moved on', body: 'Your space shifted a little.' };
    case 'location_request':
      return {
        title: `${fromName ?? 'Your partner'} would like your location`,
        body: 'Share where you are, just this once?',
      };
    case 'location_granted':
      return {
        title: `${fromName ?? 'Your partner'} shared their location`,
        body: 'Take a look — it only lasts a moment.',
      };
    case 'location_stopped':
      return {
        title: 'Location sharing stopped',
        body: 'Your partner stopped sharing their location.',
      };
    case 'letter_sealed':
      // Never the words, never the date — just the fact that something is
      // waiting.
      return { title: 'A letter, sealed', body: 'They sealed something for a future day.' };
    case 'event_added':
      // Day of week at most — never the title, never the details.
      return {
        title: 'They planned something',
        body: dayOfWeek
          ? `They planned something for ${dayOfWeek}.`
          : 'They planned something — take a look.',
      };
    case 'event_updated':
      return {
        title: 'A plan changed',
        body: dayOfWeek
          ? `Something on ${dayOfWeek} shifted a little.`
          : 'One of your plans shifted a little.',
      };
    case 'event_deleted':
      return { title: 'A plan let go', body: 'One of your plans was let go.' };
    case 'proposal_received':
      // Never the title, never the time — just a gentle invitation.
      return {
        title: 'A time, suggested',
        body: 'Your partner suggested a time for the two of you.',
      };
    case 'proposal_accepted':
      return { title: 'They said yes', body: 'Your partner accepted a time you suggested.' };
    case 'proposal_declined':
      return { title: 'Not this time', body: 'Your partner passed on a time — gently.' };
  }
}
