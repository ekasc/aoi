import AsyncStorage from '@react-native-async-storage/async-storage';

import { collectionStorageKey } from '@/features/collections/local-collections-repository';
import type {
  Collection,
  CollectionColor,
  CollectionItem,
  CollectionStatus,
} from '@/features/collections/types';
import { previewImages } from '@/features/dev/preview-media';

/**
 * The mock world's lists, for `EXPO_PUBLIC_DEV_SEED`.
 *
 * The seeded session runs the REAL Ours screen through the REAL provider tree,
 * so the stub repository reads whatever is in storage. This writes a small but
 * representative catalogue into the same key the repository uses, before the
 * providers hydrate: some things with covers and some without, and every status
 * and score in use, so the catalogue is exercised rather than merely populated.
 *
 * Dev-only by construction: only the dev seeder calls it, and the seeder is
 * `__DEV__`- and flag-gated.
 */

type SeedItem = {
  title: string;
  status: CollectionStatus;
  score: number | null;
  cover?: string;
  note?: string;
};

type SeedList = {
  id: string;
  name: string;
  color: CollectionColor;
  items: SeedItem[];
};

const { lakeSunset, pier, stormTable, roadTrip, aquariumPoster, beachPoster } = previewImages;

const SEED_LISTS: SeedList[] = [
  {
    id: 'dev-list-films',
    name: 'Films to watch',
    color: 'sky',
    items: [
      { title: 'Perfect Days', status: 'done', score: 9, cover: lakeSunset.uri },
      { title: 'Past Lives', status: 'done', score: 8, cover: pier.uri },
      { title: 'The Quiet Girl', status: 'doing', score: null, cover: stormTable.uri },
      { title: 'Aftersun', status: 'want', score: null, cover: roadTrip.uri },
      { title: 'Drive My Car', status: 'want', score: null, cover: aquariumPoster.uri },
      { title: 'Petite Maman', status: 'want', score: null },
    ],
  },
  {
    id: 'dev-list-places',
    name: 'Places to go',
    color: 'sage',
    items: [
      { title: 'The tide pools at dawn', status: 'done', score: 10, cover: beachPoster.uri },
      { title: 'That noodle place on 4th', status: 'done', score: 7, note: 'The one with no sign' },
      { title: 'The botanical garden', status: 'want', score: null, cover: roadTrip.uri },
      { title: 'A cabin with no signal', status: 'want', score: null },
    ],
  },
  {
    id: 'dev-list-recipes',
    name: 'Recipes to try',
    color: 'amber',
    items: [
      { title: 'Miso butter noodles', status: 'done', score: 8 },
      { title: 'Lemon ricotta cake', status: 'done', score: 9, note: 'Double the lemon' },
      { title: 'Kimchi pancakes', status: 'doing', score: null },
      { title: 'Roast tomato soup', status: 'want', score: null },
      { title: 'Focaccia', status: 'want', score: null },
    ],
  },
  {
    id: 'dev-list-books',
    name: 'Books to share',
    color: 'lilac',
    items: [
      { title: 'Piranesi', status: 'doing', score: null },
      { title: 'The Summer Book', status: 'want', score: null },
      { title: 'Gilead', status: 'want', score: null },
    ],
  },
  {
    id: 'dev-list-flat',
    name: 'Things for the flat',
    color: 'clay',
    items: [
      { title: 'A bigger lamp for the corner', status: 'done', score: 6 },
      { title: 'Two more dining chairs', status: 'want', score: null },
    ],
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number, hour = 12): string {
  const date = new Date(Date.now() - days * DAY_MS);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function build(): { collections: Collection[]; items: CollectionItem[] } {
  const collections: Collection[] = [];
  const items: CollectionItem[] = [];

  SEED_LISTS.forEach((list, listIndex) => {
    collections.push({
      id: list.id,
      name: list.name,
      emoji: null,
      color: list.color,
      position: listIndex,
      itemCount: list.items.length,
      createdAt: daysAgo(200 - listIndex * 20),
      updatedAt: daysAgo(listIndex + 1),
    });

    list.items.forEach((item, itemIndex) => {
      const createdAt = daysAgo(2 + itemIndex * 4 + listIndex * 3, 18);
      items.push({
        id: `${list.id}-item-${itemIndex}`,
        collectionId: list.id,
        title: item.title,
        note: item.note ?? null,
        link: null,
        coverUrl: item.cover ?? null,
        status: item.status,
        score: item.score,
        position: itemIndex,
        createdAt,
        updatedAt: createdAt,
      });
    });
  });

  return { collections, items };
}

/** Write the mock catalogue where the stub repository will read it. */
export async function seedDevCollections(spaceId: string): Promise<void> {
  const { collections, items } = build();
  await AsyncStorage.setItem(
    collectionStorageKey(spaceId),
    JSON.stringify({ collections, items })
  );
}
