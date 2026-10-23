import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('@/features/api-client', () => ({ apiFetch: api.apiFetch }));

import { remoteCollectionsRepository } from '@/features/collections/remote-collections-repository';

/**
 * The Ours screen shows a preview of every shelf. The regression this guards is
 * a round trip per shelf: at a hundred lists that is a hundred requests where
 * one will do.
 */
describe('remote collections previews', () => {
  beforeEach(() => {
    api.apiFetch.mockReset();
  });

  it('asks for every shelf in one request', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    api.apiFetch.mockResolvedValue({ previews: [] });

    await remoteCollectionsRepository.listPreviews(ids);

    expect(api.apiFetch).toHaveBeenCalledTimes(1);
    expect(api.apiFetch).toHaveBeenCalledWith('/v1/spaces/current/collection-previews');
  });

  it('maps the response back onto every requested shelf', async () => {
    api.apiFetch.mockResolvedValue({
      previews: [
        {
          collectionId: 'b',
          covers: ['https://example.invalid/cover.jpg', null],
          counts: { want: 0, doing: 1, done: 2 },
          titles: ['Second', 'Third'],
          total: 9,
        },
      ],
    });

    const previews = await remoteCollectionsRepository.listPreviews(['a', 'b']);

    expect(previews.b).toEqual({
      covers: ['https://example.invalid/cover.jpg', null],
      counts: { want: 0, doing: 1, done: 2 },
      titles: ['Second', 'Third'],
      total: 9,
    });
    // A shelf the server did not mention is shown empty, not missing, so the
    // screen never has to guard for an absent preview.
    expect(previews.a).toEqual({
      covers: [],
      counts: { want: 0, doing: 0, done: 0 },
      titles: [],
      total: 0,
    });
  });

  it('does not call the server when there is nothing to preview', async () => {
    await expect(remoteCollectionsRepository.listPreviews([])).resolves.toEqual({});
    expect(api.apiFetch).not.toHaveBeenCalled();
  });
});
