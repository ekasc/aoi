import { describe, expect, it } from 'vitest';

import { sortFeedOldestFirst } from '@/features/moments/story-feed';
import type { Moment } from '@/features/moments/types';

function memory(index: number): Moment {
  return {
    id: `memory-${String(index).padStart(6, '0')}`, type: 'note', title: '', body: '',
    occurredAt: new Date(Date.UTC(2020, 0, 1 + index % 2000)).toISOString(),
    createdAt: '2026-01-01T00:00:00Z', authorId: 'author', authorRole: 'you', authorName: 'You',
  };
}

function referenceSort(moments: Moment[]): Moment[] {
  return moments.filter((moment) => moment.type !== 'goal').sort((left, right) => {
    const a = Date.parse(left.occurredAt);
    const b = Date.parse(right.occurredAt);
    const aUndated = !Number.isFinite(a);
    const bUndated = !Number.isFinite(b);
    if (aUndated !== bUndated) return aUndated ? 1 : -1;
    if (!aUndated && a !== b) return a < b ? -1 : 1;
    return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
  });
}

describe('archive ordering cost and behavior', () => {
  it('reads each eligible timestamp once rather than during every sort comparison', () => {
    let reads = 0;
    const moments = Array.from({ length: 2000 }, (_, index) => {
      const item = memory(index);
      const stamp = item.occurredAt;
      return { ...item, get occurredAt() { reads += 1; return stamp; } };
    }).reverse();
    const sorted = sortFeedOldestFirst(moments);
    expect(reads).toBe(moments.length);
    expect(sorted.map((item) => item.id)).toEqual([...moments].reverse().map((item) => item.id));
  });

  it('preserves ordering, ties, undated records, goal exclusion and input identity', () => {
    const moments = Array.from({ length: 5000 }, (_, index) => memory(index)).reverse();
    moments.push({ ...memory(5001), occurredAt: 'bad date' });
    moments.push({ ...memory(5002), occurredAt: 'bad date' });
    moments.push({ ...memory(5003), type: 'goal' });
    const original = [...moments];
    expect(sortFeedOldestFirst(moments)).toEqual(referenceSort(moments));
    expect(moments).toEqual(original);
    const once = sortFeedOldestFirst(moments);
    expect(sortFeedOldestFirst(once)).toEqual(once);
    expect(once.every((item) => moments.includes(item))).toBe(true);
  });

  it('compares current and comparator-parsing costs on the same 10000-memory input', () => {
    const moments = Array.from({ length: 10000 }, (_, index) => memory((index * 7919) % 10000));
    referenceSort(moments);
    sortFeedOldestFirst(moments);
    const samples = (run: () => unknown) => {
      const results = Array.from({ length: 7 }, () => {
        const start = performance.now();
        run();
        return performance.now() - start;
      }).sort((left, right) => left - right);
      return Number(results[3].toFixed(2));
    };
    const referenceMs = samples(() => referenceSort(moments));
    const currentMs = samples(() => sortFeedOldestFirst(moments));
    console.log(JSON.stringify({ benchmark: 'memory-ordering', count: moments.length, referenceMs, currentMs,
      environment: 'desktop JavaScript; not native frame timing' }));
    expect(sortFeedOldestFirst(moments)).toEqual(referenceSort(moments));
  });
});
