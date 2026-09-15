import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Remote moments API contract pins: the wire payload for create carries the
 * draft-derived clientId + stable mediaId, and update carries mediaId —
 * matching the shared zod contract exactly. Fetch is mocked; the assertions
 * are about what the client SENDS and how it parses the server's response.
 */

const baseUrl = 'https://api.test.local';

function stubFetch(mock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', mock);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_AUTH_STUB_MODE', 'false');
  vi.stubEnv('EXPO_PUBLIC_AUTH_API_BASE_URL', baseUrl);
  const apiClient = await import('@/features/api-client');
  apiClient.setApiTokens({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
});

describe('remote-moments-api', () => {
  it('create sends clientId + stable mediaId and parses the returned moment', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${baseUrl}/v1/spaces/current/moments`) {
        const sent = JSON.parse(String(init?.body));
        expect(sent.clientId).toBe('draft_1234abcd');
        expect(sent.mediaId).toBe('media-1');
        expect(sent.mediaPreview).toBe('/v1/media/media-1/object?variant=display');
        return jsonResponse({
          id: 'moment-9',
          type: 'media',
          title: 'Us',
          body: '',
          occurredAt: '2026-03-15T10:00:00.000Z',
          targetAt: null,
          createdAt: '2026-03-15T10:00:00.000Z',
          updatedAt: '2026-03-15T10:00:00.000Z',
          authorId: 'user-1',
          authorRole: 'you',
          authorName: 'You',
          isOwn: true,
          mediaPreview: '/v1/media/media-1/object?variant=display',
          audioUri: null,
          mediaId: 'media-1',
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    stubFetch(fetchMock);

    const { createMoment } = await import('@/features/moments/remote-moments-api');
    const moment = await createMoment({
      type: 'media',
      title: 'Us',
      body: '',
      occurredAt: '2026-03-15T10:00:00.000Z',
      targetAt: null,
      mediaPreview: '/v1/media/media-1/object?variant=display',
      audioUri: null,
      mediaId: 'media-1',
      clientId: 'draft_1234abcd',
    });

    expect(moment.id).toBe('moment-9');
    expect(moment.mediaId).toBe('media-1');
    expect(moment.mediaPreview).toBe('/v1/media/media-1/object?variant=display');
  });

  it('update carries mediaId alongside mediaPreview', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${baseUrl}/v1/moments/moment-9`) {
        const sent = JSON.parse(String(init?.body));
        expect(sent.mediaId).toBe('media-2');
        expect(sent.mediaPreview).toBe('/v1/media/media-2/object?variant=display');
        return jsonResponse({
          id: 'moment-9',
          type: 'media',
          title: 'Us',
          body: '',
          occurredAt: '2026-03-15T10:00:00.000Z',
          targetAt: null,
          createdAt: '2026-03-15T10:00:00.000Z',
          updatedAt: '2026-03-15T10:00:00.000Z',
          authorId: 'user-1',
          authorRole: 'you',
          authorName: 'You',
          isOwn: true,
          mediaPreview: '/v1/media/media-2/object?variant=display',
          audioUri: null,
          mediaId: 'media-2',
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    stubFetch(fetchMock);

    const { updateMoment } = await import('@/features/moments/remote-moments-api');
    const moment = await updateMoment('moment-9', {
      mediaPreview: '/v1/media/media-2/object?variant=display',
      audioUri: null,
      mediaId: 'media-2',
    });
    expect(moment.mediaId).toBe('media-2');
  });

  it('fetches the moments feed and passes the cursor through', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${baseUrl}/v1/spaces/current/moments?limit=20`) {
        return jsonResponse({
          moments: [],
          nextCursor: '1730000000000|moment-9',
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    stubFetch(fetchMock);

    const { fetchMoments } = await import('@/features/moments/remote-moments-api');
    const page = await fetchMoments();
    expect(page.nextCursor).toBe('1730000000000|moment-9');

    // Cursor is encoded into the query string for the next page.
    const cursorFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe(
        `${baseUrl}/v1/spaces/current/moments?limit=20&cursor=${encodeURIComponent('1730000000000|moment-9')}`
      );
      return jsonResponse({ moments: [], nextCursor: undefined });
    });
    stubFetch(cursorFetch);
    await fetchMoments('1730000000000|moment-9');
  });

  it('fetches the bounded anchor window for a saved id', async () => {
    const anchor = '11111111-1111-4111-8111-111111111111';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/v1/spaces/current/moments/timeline?');
      expect(url).toContain(`anchor=${anchor}`);
      expect(url).toContain('limit=30');
      return jsonResponse({
        moments: [],
        olderCursor: null,
        newerCursor: null,
        firstUnread: null,
        unreadCount: 0,
      });
    });
    stubFetch(fetchMock);

    const { fetchTimeline } = await import('@/features/moments/remote-moments-api');
    const page = await fetchTimeline({ anchor, limit: 30 });
    expect(page.moments).toEqual([]);
    expect(page.firstUnread).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
