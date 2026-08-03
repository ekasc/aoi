import { describe, it, expect, beforeEach } from 'vitest';

import { createLocalSomedayRepository } from '@/features/someday/local-someday-repository';
import type { SomedayItem } from '@/features/someday/types';

const mockStorage = (globalThis as any).__mockAsyncStorage;

function makeStoredItem(overrides: Partial<SomedayItem> = {}): SomedayItem {
  return {
    id: `someday_${Math.floor(Math.random() * 1000000)}`,
    title: 'A picnic on the hill',
    category: 'place',
    createdByRole: 'you',
    createdAt: '2026-07-01T10:00:00.000Z',
    checkedAt: null,
    checkedByRole: null,
    ...overrides,
  };
}

async function seedItems(userId: string, items: SomedayItem[]) {
  await mockStorage.setItem(`aoi.someday.v1.${userId}`, JSON.stringify(items));
}

describe('local someday repository', () => {
  beforeEach(async () => {
    await mockStorage.clear();
  });

  it('adds items and lists them, newest open item first', async () => {
    const repo = createLocalSomedayRepository('user-1');

    await repo.add({ title: 'First idea', category: 'film' });
    await repo.add({ title: 'Second idea', category: 'food' });

    const items = await repo.list();
    expect(items.map((item) => item.title)).toEqual(['Second idea', 'First idea']);
    expect(items[0]).toMatchObject({
      category: 'food',
      createdByRole: 'you',
      checkedAt: null,
      checkedByRole: null,
    });
  });

  it('trims titles and rejects blank ones', async () => {
    const repo = createLocalSomedayRepository('user-1');

    await repo.add({ title: '  Ramen night  ', category: 'food' });
    const items = await repo.list();
    expect(items[0].title).toBe('Ramen night');

    await expect(repo.add({ title: '   ' })).rejects.toThrow();
  });

  it('stores an optional trimmed note and defaults category to other', async () => {
    const repo = createLocalSomedayRepository('user-1');

    await repo.add({ title: 'That film', note: '  the one Mara mentioned ' });
    const items = await repo.list();
    expect(items[0]).toMatchObject({ category: 'other', note: 'the one Mara mentioned' });
  });

  it('orders open items first (newest first), then checked items (most recently checked first)', async () => {
    const repo = createLocalSomedayRepository('user-1');
    await seedItems('user-1', [
      makeStoredItem({ id: 'a', title: 'Old open', createdAt: '2026-06-01T10:00:00.000Z' }),
      makeStoredItem({
        id: 'b',
        title: 'Checked long ago',
        createdAt: '2026-06-02T10:00:00.000Z',
        checkedAt: '2026-07-02T10:00:00.000Z',
        checkedByRole: 'you',
      }),
      makeStoredItem({ id: 'c', title: 'New open', createdAt: '2026-07-10T10:00:00.000Z' }),
      makeStoredItem({
        id: 'd',
        title: 'Checked recently',
        createdAt: '2026-06-15T10:00:00.000Z',
        checkedAt: '2026-07-20T10:00:00.000Z',
        checkedByRole: 'you',
      }),
    ]);

    const items = await repo.list();
    expect(items.map((item) => item.title)).toEqual([
      'New open',
      'Old open',
      'Checked recently',
      'Checked long ago',
    ]);
  });

  it('checking off sets checkedAt and checkedByRole; undo clears them', async () => {
    const repo = createLocalSomedayRepository('user-1');
    const created = await repo.add({ title: 'Night market', category: 'food' });

    const checked = await repo.update(created.id, { checked: true });
    expect(checked).toMatchObject({
      id: created.id,
      checkedByRole: 'you',
    });
    expect(typeof checked?.checkedAt).toBe('string');

    const undone = await repo.update(created.id, { checked: false });
    expect(undone).toMatchObject({
      id: created.id,
      checkedAt: null,
      checkedByRole: null,
    });
  });

  it('only meaningful transitions write: re-checking keeps the original checkedAt', async () => {
    const repo = createLocalSomedayRepository('user-1');
    const created = await repo.add({ title: 'Night market', category: 'food' });

    const checked = await repo.update(created.id, { checked: true });
    const reChecked = await repo.update(created.id, { checked: true });
    expect(reChecked?.checkedAt).toBe(checked?.checkedAt);

    const reUndone = await repo.update(created.id, { checked: false });
    const reUndoneAgain = await repo.update(created.id, { checked: false });
    expect(reUndoneAgain).toEqual(reUndone);
  });

  it('edits title, note and category', async () => {
    const repo = createLocalSomedayRepository('user-1');
    const created = await repo.add({ title: 'Picnic', category: 'place' });

    const updated = await repo.update(created.id, {
      title: 'Sunset picnic',
      note: 'bring the good blanket',
      category: 'other',
    });
    expect(updated).toMatchObject({
      title: 'Sunset picnic',
      note: 'bring the good blanket',
      category: 'other',
    });

    // An empty note clears it.
    const cleared = await repo.update(created.id, { note: '' });
    expect(cleared?.note).toBeUndefined();
  });

  it('returns null when updating a missing item', async () => {
    const repo = createLocalSomedayRepository('user-1');
    expect(await repo.update('missing', { checked: true })).toBeNull();
  });

  it('keeps lists separate per user', async () => {
    const mine = createLocalSomedayRepository('user-1');
    const theirs = createLocalSomedayRepository('user-2');

    await mine.add({ title: 'My list item', category: 'film' });

    expect(await theirs.list()).toEqual([]);
    expect(await mine.list()).toHaveLength(1);
  });

  it('recovers gracefully from corrupted stored JSON', async () => {
    await mockStorage.setItem('aoi.someday.v1.user-1', '{not valid json');
    const repo = createLocalSomedayRepository('user-1');
    expect(await repo.list()).toEqual([]);
  });

  it('filters out malformed stored entries', async () => {
    await seedItems('user-1', [
      makeStoredItem({ id: 'good', title: 'Good item' }),
      { id: 'bad', title: 42 } as unknown as SomedayItem,
      null as unknown as SomedayItem,
    ]);
    const repo = createLocalSomedayRepository('user-1');
    const items = await repo.list();
    expect(items.map((item) => item.id)).toEqual(['good']);
  });
});
