import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildSimulatedPartnerPost,
  loadSimulatedPosts,
  saveSimulatedPosts,
} from '@/features/dev/simulate-partner';

const NOW = new Date('2026-09-17T20:00:00.000Z');

beforeEach(async () => {
  await globalThis.__mockAsyncStorage.clear();
});

describe('buildSimulatedPartnerPost', () => {
  it('builds a partner-authored post, never your own', () => {
    const input = buildSimulatedPartnerPost('June', {}, NOW);
    expect(input.authorRole).toBe('partner');
    expect(input.authorId).toBe('user_partner');
    expect(input.authorName).toBe('June');
    expect(input.occurredAt).toBe('2026-09-17T20:00:00.000Z');
    expect(input.title?.trim()).not.toBe('');
  });

  it('falls back to Partner without a space name, and honors overrides', () => {
    const fallback = buildSimulatedPartnerPost(null, {}, NOW);
    expect(fallback.authorName).toBe('Partner');

    const custom = buildSimulatedPartnerPost('June', {
      title: 'Sunset',
      body: 'Look outside.',
      occurredAt: '2026-09-16T18:00:00.000Z',
    }, NOW);
    expect(custom.title).toBe('Sunset');
    expect(custom.body).toBe('Look outside.');
    expect(custom.occurredAt).toBe('2026-09-16T18:00:00.000Z');
    // Overrides never flip authorship: the post stays theirs.
    expect(custom.authorRole).toBe('partner');
  });
});

describe('simulated post storage', () => {
  it('round-trips planted posts and drops garbage', async () => {
    expect(await loadSimulatedPosts()).toEqual([]);
    await saveSimulatedPosts([
      {
        id: 'sim-1',
        type: 'note',
        title: 'Hi',
        body: '',
        occurredAt: '2026-09-17T20:00:00.000Z',
        targetAt: null,
        createdAt: '2026-09-17T20:00:00.000Z',
        updatedAt: '2026-09-17T20:00:00.000Z',
        authorId: 'user_partner',
        authorRole: 'partner',
        authorName: 'June',
        isOwn: false,
      },
    ]);
    const loaded = await loadSimulatedPosts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('sim-1');

    await globalThis.__mockAsyncStorage.setItem(
      'aoi.dev.simulated-posts.v1',
      '[{"id": 42}]',
    );
    expect(await loadSimulatedPosts()).toEqual([]);
  });
});
