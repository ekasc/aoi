import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MOMENT_RECONCILE_LIMIT } from '@aoi/shared';

import { reconcileMoments } from '@/features/moments/remote-moments-api';
import type { Moment } from '@/features/moments/types';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/api-client', () => ({ apiFetch: fetchMock }));

function moment(index: number): Moment {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    type: 'note', title: '', body: '', occurredAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    authorId: 'author', authorName: 'You', authorRole: 'you', isOwn: true,
    attachments: [],
  };
}

beforeEach(() => { fetchMock.mockReset(); });

describe('bounded loaded-memory reconciliation', () => {
  it('does no network work for an empty window', async () => {
    expect(await reconcileMoments([], () => {})).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('batches and deduplicates loaded ids, with no more than three requests in flight', async () => {
    const loaded = Array.from({ length: 500 }, (_, index) => moment(index));
    const byId = new Map(loaded.map((item) => [item.id, item]));
    const requested: string[] = [];
    let inFlight = 0;
    let maximum = 0;
    fetchMock.mockImplementation(async (path: string, init: RequestInit) => {
      const { ids } = JSON.parse(String(init.body)) as { ids: string[] };
      expect(path).toBe('/v1/spaces/current/moments/reconcile');
      expect(init.method).toBe('POST');
      expect(ids.length).toBeLessThanOrEqual(MOMENT_RECONCILE_LIMIT);
      requested.push(...ids);
      maximum = Math.max(maximum, ++inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { moments: ids.map((id) => byId.get(id)) };
    });
    const result = await reconcileMoments([...loaded, loaded[0]], () => {});
    expect(result).toEqual(loaded);
    expect(requested).toEqual(loaded.map((item) => item.id));
    expect(maximum).toBe(3);
  });

  it('stops before another batch if its scope is superseded', async () => {
    let current = true;
    fetchMock.mockImplementation(async () => {
      await Promise.resolve();
      current = false;
      return { moments: [] };
    });
    await expect(reconcileMoments(
      Array.from({ length: 500 }, (_, index) => moment(index)),
      () => { if (!current) throw new Error('Superseded'); }
    )).rejects.toThrow('Superseded');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    { moments: null },
    { moments: [{ id: 'incomplete' }] },
    { moments: [moment(99)] },
  ])('rejects invalid or unrequested records instead of replacing the window', async (response) => {
    fetchMock.mockResolvedValue(response);
    await expect(reconcileMoments([moment(1)], () => {})).rejects.toThrow();
  });
});
