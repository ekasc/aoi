import { describe, expect, it } from 'vitest';

import { createDefaultComposerStore } from '@/features/composer/composer-memory-adapters';
import {
  PREVIEW_SCOPE,
  PREVIEW_SESSION,
  PREVIEW_SPACE,
  getPreviewPending,
  getPreviewSeedMoments,
  parsePreviewVariant,
  resetPreviewComposerStore,
} from '@/features/dev/preview';

const HTTPS = /^https:\/\//;

describe('dev preview mock world', () => {
  it('parses variants with a safe default', () => {
    expect(parsePreviewVariant(undefined)).toBe('full');
    expect(parsePreviewVariant('empty')).toBe('empty');
    expect(parsePreviewVariant('pending')).toBe('pending');
    expect(parsePreviewVariant('failed')).toBe('failed');
    expect(parsePreviewVariant('bogus')).toBe('full');
    expect(parsePreviewVariant(['failed'])).toBe('failed');
  });

  it('seeds a two-person spread of remote photos, voice, and video', () => {
    const seeds = getPreviewSeedMoments('full');
    expect(seeds).toHaveLength(12);
    const byId = new Map(seeds.map((moment) => [moment.id, moment]));

    // Photos from both members, all loaded from the network (no bundled
    // asset URIs — remote URLs only).
    expect(byId.get('preview-photo-now')?.mediaPreview).toMatch(HTTPS);
    expect(byId.get('preview-photo-partner')?.mediaPreview).toMatch(HTTPS);
    expect(byId.get('preview-photo-old')?.mediaPreview).toMatch(HTTPS);
    expect(byId.get('preview-photo-partner-old')?.mediaPreview).toMatch(HTTPS);

    // Voice notes from Maya (own) and June (partner).
    expect(byId.get('preview-voice-own')?.audioUri).toMatch(HTTPS);
    expect(byId.get('preview-voice-partner')?.audioUri).toMatch(HTTPS);

    // Video from both members, each with a remote poster still.
    const ownVideo = byId.get('preview-video-own');
    const partnerVideo = byId.get('preview-video-partner');
    expect(ownVideo?.videoUri).toMatch(HTTPS);
    expect(partnerVideo?.videoUri).toMatch(HTTPS);
    expect(ownVideo?.mediaPreview).toMatch(HTTPS);
    expect(partnerVideo?.mediaPreview).toMatch(HTTPS);

    // Partner memories read as theirs.
    expect(byId.get('preview-note-partner')?.isOwn).toBe(false);
    expect(byId.get('preview-voice-partner')?.isOwn).toBe(false);
    expect(byId.get('preview-video-partner')?.isOwn).toBe(false);

    expect(byId.get('preview-goal')?.type).toBe('goal');

    // Resurface-eligible: same month/day as today, at least a year back.
    const now = new Date();
    const oldie = new Date(byId.get('preview-resurface')?.occurredAt ?? '');
    expect(oldie.getMonth()).toBe(now.getMonth());
    expect(oldie.getDate()).toBe(now.getDate());
    expect(now.getFullYear() - oldie.getFullYear()).toBeGreaterThanOrEqual(1);

    expect(getPreviewSeedMoments('empty')).toEqual([]);
  });

  it('seeds pending rows per variant', () => {
    expect(getPreviewPending('full')).toEqual([]);
    expect(getPreviewPending('empty')).toEqual([]);
    const [queued] = getPreviewPending('pending');
    expect(queued.status).toBe('queued');
    expect(queued.slots).toEqual([]);
    expect(queued.scope).toEqual(PREVIEW_SCOPE);
    const [failed] = getPreviewPending('failed');
    expect(failed.status).toBe('failed');
    expect(failed.errorMessage).toBeTruthy();
  });

  it('provides a signed-in session and a ready space', () => {
    expect(PREVIEW_SESSION.status).toBe('signed_in');
    expect(PREVIEW_SESSION.isHydrated).toBe(true);
    expect(PREVIEW_SESSION.user?.displayName).toBe('Maya');
    expect(PREVIEW_SPACE.status).toBe('ready');
    expect(PREVIEW_SPACE.space?.partnerName).toBe('June');
    expect(PREVIEW_SPACE.isHydrated).toBe(true);
  });

  it('writes variant pending into the shared composer store, keeping drafts', async () => {
    await resetPreviewComposerStore('failed');
    const store = createDefaultComposerStore();
    const loaded = await store.loadManifest(PREVIEW_SCOPE);
    expect(loaded.pending).toHaveLength(1);
    expect(loaded.pending[0].status).toBe('failed');
    await resetPreviewComposerStore('full');
    expect((await store.loadManifest(PREVIEW_SCOPE)).pending).toEqual([]);
  });
});
