import {
  Component,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactNode,
} from 'react';

import type { PendingRecord } from '@/features/composer/types';
import { createDefaultComposerStore } from '@/features/composer/composer-memory-adapters';
import {
  previewAudio,
  previewImages,
  previewVideos,
} from '@/features/dev/preview-media';
import type { Moment } from '@/features/moments/types';
import type { SessionContextValue } from '@/features/session/types';
import type { SpaceContextValue } from '@/features/space/types';

/**
 * Dev-preview plumbing for visual debugging (agent-browser + eyes).
 *
 * Why this exists: authenticated screens are unreachable on web (SecureStore
 * has no web implementation, so sessions never persist there) and simulators
 * are slow and ask-first. These routes render REAL screens through the REAL
 * provider tree on the normal dev server — no DOM shims, no throwaway
 * harnesses, no duplicated fixtures.
 *
 * Safety: same convention as app/dev-foundations.tsx — preview routes
 * redirect home unless `__DEV__`, and nothing below activates in
 * production either. Never link to /dev-* from app UI.
 *
 * Data flow (explicit, no render side effects): the dev route publishes
 * `?variant=` via `useApplyPreviewVariant` (a mount/unmount effect around
 * a tiny external store) and seeds the composer store before the providers
 * mount. Stub data implementations (which exist precisely for backend-less
 * local development) subscribe with `usePreviewVariant()` and swap their
 * seeds — same logic, richer fixtures. A store, not React context, because
 * the stub providers mount at the root layout ABOVE any route: context
 * flows down and could never reach them. When nothing is published,
 * behavior is byte-for-byte today's.
 *
 * The mock world: Maya & June, signed in, space ready. Saving a memory in
 * preview runs the real composer pipeline against stub storage, so text
 * keeps and failed-send retries land in the feed for real. Every photo,
 * voice note, and video is a remote fixture (features/dev/preview-media)
 * fetched over HTTPS — nothing bundled, nothing inlined — so the preview
 * exercises the same network path in Expo Go and dev builds and both
 * members author media. Plus-gated export still needs a backend session,
 * so it shows its status error headless — expected.
 */

export type PreviewVariant = 'full' | 'empty' | 'pending' | 'failed';

export function parsePreviewVariant(raw: string | string[] | undefined): PreviewVariant {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'empty' || value === 'pending' || value === 'failed') {
    return value;
  }
  return 'full';
}

type PreviewState = {
  /** True only while a dev route has published a variant (dev builds only). */
  active: boolean;
  variant: PreviewVariant;
};

const PREVIEW_INACTIVE: PreviewState = { active: false, variant: 'full' };

// Tiny external store (useSyncExternalStore): the stub data providers live
// at the ROOT layout, ABOVE any route, so a React context provided by a dev
// route can never reach them — context flows down. Module state set from a
// route effect, subscribed by the stubs, has no such restriction.
let currentVariant: PreviewVariant | null = null;
const listeners = new Set<() => void>();

function subscribePreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getPreviewSnapshot(): PreviewVariant | null {
  return currentVariant;
}

function getPreviewServerSnapshot(): PreviewVariant | null {
  return null;
}

function publishPreviewVariant(variant: PreviewVariant | null): void {
  if (currentVariant === variant) {
    return;
  }
  currentVariant = variant;
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

/**
 * Dev routes call this (it is just an effect around the store above):
 * publishes the variant on mount, clears it on unmount. Safe under
 * StrictMode (set → cleanup → set settles published).
 */
export function useApplyPreviewVariant(variant: PreviewVariant): void {
  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    publishPreviewVariant(variant);
    return () => {
      publishPreviewVariant(null);
    };
  }, [variant]);
}

/**
 * The variant requested by `EXPO_PUBLIC_DEV_SEED`, or null when unset.
 *
 * This is the supported way to run the REAL app tree (tabs, navigation,
 * every screen) against the seeded mock world: set the flag, start the dev
 * server, and the app boots signed in as Maya with June's space and the
 * rich media seeds — no separate preview route, no navigation bypassed.
 * Read once at module load; it is a build-time env value.
 */
export function getDevSeedVariant(): PreviewVariant | null {
  if (!__DEV__) {
    return null;
  }
  const raw = process.env.EXPO_PUBLIC_DEV_SEED?.trim();
  if (!raw) {
    return null;
  }
  return parsePreviewVariant(raw);
}

/**
 * Publishes the `EXPO_PUBLIC_DEV_SEED` variant for the lifetime of the
 * calling tree. Mounted by the authenticated app layout so the real tabs
 * render seeded data. No-op when the flag is unset, so normal dev and
 * production behavior is unchanged.
 */
export function useDevSeed(): void {
  const variant = useMemo(() => getDevSeedVariant(), []);
  useEffect(() => {
    if (!variant) {
      return;
    }
    publishPreviewVariant(variant);
    return () => {
      publishPreviewVariant(null);
    };
  }, [variant]);
}

/** Safe to call anywhere (features included — no expo-router here). */
export function usePreviewVariant(): PreviewState {
  const variant = useSyncExternalStore(
    subscribePreview,
    getPreviewSnapshot,
    getPreviewServerSnapshot
  );
  return useMemo(
    () => (variant && __DEV__ ? { active: true, variant } : PREVIEW_INACTIVE),
    [variant]
  );
}

type ErrorBoundaryState = { error: Error | null; componentStack: string };

/**
 * Dev-only crash overlay: renders the error message + component stack as
 * text so agent-browser (and eyes) can read the actual failure instead of
 * React's generic fallback. Used by dev routes only.
 */
export class DevErrorBoundary extends Component<
  PropsWithChildren<{ label: string }>,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(_error: Error, info: { componentStack?: string }) {
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <pre
        data-testid="dev-error"
        style={{ padding: 16, color: '#8F3A2A', whiteSpace: 'pre-wrap' }}
      >
        {`CRASH in ${this.props.label}: ${error.message}\n${componentStack}`}
      </pre>
    );
  }
}

// ── Mock world: session + space ─────────────────────────────────────────
// Static values (module constants: stable identity, no provider churn).
// Mutations resolve honestly: preview spaces are fixed, so they throw an
// explicit error instead of pretending to work.

export const PREVIEW_SCOPE = { viewerId: 'preview-maya', spaceId: 'preview-space' };

function previewUnavailable(feature: string): () => Promise<never> {
  return async () => {
    throw new Error(`Preview ${feature} is fixed; this action is unavailable.`);
  };
}

export const PREVIEW_SESSION: SessionContextValue = {
  status: 'signed_in',
  isHydrated: true,
  user: { id: 'preview-maya', email: 'maya@example.com', displayName: 'Maya' },
  tokens: {
    accessToken: 'preview-token',
    refreshToken: 'preview-refresh',
    expiresAt: '2030-01-01T00:00:00.000Z',
  },
  signInWithProvider: async () => ({ ok: true }),
  restoreSession: async () => {},
  signOut: async () => {},
  deleteAccount: async () => {},
};

export const PREVIEW_SPACE: SpaceContextValue = {
  status: 'ready',
  space: {
    id: 'preview-space',
    name: 'Maya & June',
    createdByUserId: 'preview-maya',
    yourName: 'Maya',
    partnerName: 'June',
    relationshipStartDate: '2022-06-14',
    inviteCode: 'PREVIEW1',
    partnerJoined: true,
    inviteExpiresAt: null,
    createdAt: '2022-06-14T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  importedMilestones: [],
  isHydrated: true,
  createSpace: previewUnavailable('spaces'),
  joinSpace: previewUnavailable('spaces'),
  updateSpace: previewUnavailable('spaces'),
  clearSpace: previewUnavailable('spaces'),
  leaveSpace: previewUnavailable('spaces'),
  regenerateInvite: previewUnavailable('invite codes'),
  importMilestones: previewUnavailable('milestone import'),
};

// ── Mock world: composer pending ────────────────────────────────────────
// Text-only records (no staged assets), so the send pipeline runs fully
// headless: retry → stub create → delivered row lands in the feed.

function seedPendingRecord(
  overrides: Partial<PendingRecord> & Pick<PendingRecord, 'clientId'>
): PendingRecord {
  const now = new Date().toISOString();
  return {
    body: 'Typing this from the platform, train is late again',
    occurredAt: now,
    slots: [],
    status: 'queued',
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    scope: { ...PREVIEW_SCOPE },
    deliveredMoment: null,
    ...overrides,
  };
}

export function getPreviewPending(variant: PreviewVariant): PendingRecord[] {
  if (variant === 'pending') {
    return [seedPendingRecord({ clientId: 'preview-pending-1' })];
  }
  if (variant === 'failed') {
    return [
      seedPendingRecord({
        clientId: 'preview-pending-1',
        status: 'failed',
        errorMessage: 'Could not send yet.',
        attempts: 1,
      }),
    ];
  }
  return [];
}

/**
 * Writes the variant's pending seeds into the shared (module-memory on
 * web) composer store, preserving any in-progress draft. The dev route
 * awaits this BEFORE mounting providers, so hydration deterministically
 * picks the seeds up — no race. Dev-only by construction (only routes
 * call it, routes are __DEV__-gated).
 */
export async function resetPreviewComposerStore(variant: PreviewVariant): Promise<void> {
  const store = createDefaultComposerStore();
  let draft = null;
  try {
    draft = (await store.loadManifest(PREVIEW_SCOPE)).draft;
  } catch {
    draft = null;
  }
  await store.saveManifest(PREVIEW_SCOPE, draft, getPreviewPending(variant));
}

// ── Seeds ────────────────────────────────────────────────────────────────
// Relative to "now" so month sections always render. All media is remote
// (features/dev/preview-media) and authored by both members, including
// voice notes and video — no bundled assets.

const DAY_MS = 24 * 60 * 60 * 1000;

/** June's authorship, spread into every partner seed. */
const PARTNER = {
  authorId: 'user_partner',
  authorRole: 'partner' as const,
  authorName: 'June',
  isOwn: false,
  isRead: false,
};

function atMidnight(daysAgo: number, hour = 12, now: number = Date.now()): string {
  const date = new Date(now - daysAgo * DAY_MS);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function sameMonthDayYearsAgo(yearsAgo: number, now: number = Date.now()): string {
  const date = new Date(now);
  date.setFullYear(date.getFullYear() - yearsAgo);
  return date.toISOString();
}

function seedMoment(overrides: Partial<Moment> & Pick<Moment, 'id' | 'occurredAt'>): Moment {
  const createdAt = overrides.createdAt ?? overrides.occurredAt;
  return {
    type: 'note',
    title: '',
    body: '',
    targetAt: null,
    createdAt,
    updatedAt: createdAt,
    authorId: 'user_you',
    authorRole: 'you',
    authorName: 'Maya',
    isOwn: true,
    isRead: true,
    mediaPreview: undefined,
    audioUri: null,
    videoUri: null,
    mediaId: null,
    ...overrides,
  } as Moment;
}

/**
 * A two-person spread across a few months: photos, voice notes, and video
 * from both Maya and June, an on-this-day oldie two years back (drives the
 * resurface pin), and one goal (must stay out of the feed — Plans owns it).
 * The repo's `?variant=empty` still returns nothing.
 */
export function getPreviewSeedMoments(variant: PreviewVariant): Moment[] {
  if (variant === 'empty') {
    return [];
  }
  return [
    // This month: Maya's lake photo, June's late note, June's voice note.
    seedMoment({
      id: 'preview-photo-now',
      type: 'media',
      title: previewImages.lakeSunset.label,
      body: 'The city hummed below us and nobody else existed for an hour.',
      occurredAt: atMidnight(1, 19),
      mediaPreview: previewImages.lakeSunset.uri,
      mediaId: 'preview-media-1',
    }),
    seedMoment({
      id: 'preview-note-partner',
      type: 'note',
      body: 'You left the porch light on again. I love that you always do that when I work late.',
      occurredAt: atMidnight(3, 22),
      ...PARTNER,
    }),
    seedMoment({
      id: 'preview-voice-partner',
      type: 'trace',
      body: 'Queued this up for your walk home.',
      occurredAt: atMidnight(5, 20),
      audioUri: previewAudio.juneVoice.uri,
      ...PARTNER,
    }),
    seedMoment({
      id: 'preview-photo-partner',
      type: 'media',
      title: previewImages.pier.label,
      occurredAt: atMidnight(12, 7),
      mediaPreview: previewImages.pier.uri,
      mediaId: 'preview-media-2',
      ...PARTNER,
    }),
    // June's beach clip — video with the poster standing in as the still.
    seedMoment({
      id: 'preview-video-partner',
      type: 'media',
      title: previewVideos.beachDog.label,
      body: 'She swam until she couldn\u2019t stand up.',
      occurredAt: atMidnight(18, 16),
      mediaPreview: previewVideos.beachDog.posterUri,
      videoUri: previewVideos.beachDog.uri,
      mediaId: 'preview-media-video-partner',
      ...PARTNER,
    }),
    // Last month: Maya's voice note and her quiet-wins note.
    seedMoment({
      id: 'preview-voice-own',
      type: 'trace',
      body: 'Humming that song from the drive home',
      occurredAt: atMidnight(27, 21),
      audioUri: previewAudio.mayaVoice.uri,
    }),
    seedMoment({
      id: 'preview-note-own',
      type: 'note',
      title: 'Small wins',
      body: 'Fixed the wobbly shelf, made soup from scratch, called mom. A good Saturday.',
      occurredAt: atMidnight(40, 18),
    }),
    // Three months back: Maya's photo and her aquarium clip.
    seedMoment({
      id: 'preview-photo-old',
      type: 'media',
      title: previewImages.stormTable.label,
      body: 'Same corner table as our first date.',
      occurredAt: atMidnight(89, 20),
      mediaPreview: previewImages.stormTable.uri,
      mediaId: 'preview-media-3',
    }),
    seedMoment({
      id: 'preview-video-own',
      type: 'media',
      title: previewVideos.aquarium.label,
      occurredAt: atMidnight(96, 11),
      mediaPreview: previewVideos.aquarium.posterUri,
      videoUri: previewVideos.aquarium.uri,
      mediaId: 'preview-media-video-own',
    }),
    // Older still: June's road-trip photo.
    seedMoment({
      id: 'preview-photo-partner-old',
      type: 'media',
      title: previewImages.roadTrip.label,
      occurredAt: atMidnight(130, 9),
      mediaPreview: previewImages.roadTrip.uri,
      mediaId: 'preview-media-4',
      ...PARTNER,
    }),
    // On this day, two years back: drives the resurface pin.
    seedMoment({
      id: 'preview-resurface',
      type: 'note',
      body: 'Rain against the windows, your head on my shoulder, nowhere to be.',
      occurredAt: sameMonthDayYearsAgo(2),
      ...PARTNER,
    }),
    // Plans owns goals; must stay out of the Story feed.
    seedMoment({
      id: 'preview-goal',
      type: 'goal',
      title: 'See the northern lights',
      occurredAt: atMidnight(10),
      targetAt: atMidnight(-120, 0),
    }),
  ];
}
