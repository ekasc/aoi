import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  COLLECTION_COLORS,
  COLLECTION_COVER_MAX,
  COLLECTION_EMOJI_MAX,
  COLLECTION_ITEM_NOTE_MAX,
  COLLECTION_ITEM_TITLE_MAX,
  COLLECTION_LINK_MAX,
  COLLECTION_NAME_MAX,
  COLLECTION_SCORE_MAX,
  COLLECTION_SCORE_MIN,
  COLLECTION_STATUSES,
  type Collection,
  type CollectionItem,
} from '@/features/collections/types';
import type {
  CollectionsRepository,
  CreateCollectionItemRequest,
  CreateCollectionRequest,
  UpdateCollectionItemRequest,
  UpdateCollectionRequest,
} from '@/features/collections/types';

const STORAGE_KEY_PREFIX = 'aoi.collections.v1.';

/** One list blob per active space, so partners on one device stay separate. */
export function collectionStorageKey(spaceId: string): string {
  return `${STORAGE_KEY_PREFIX}${spaceId}`;
}

type StoredState = {
  collections: Collection[];
  items: CollectionItem[];
};

const EMPTY: StoredState = { collections: [], items: [] };

function isCollection(value: unknown): value is Collection {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<Collection>;

  return Boolean(
    typeof candidate.id === 'string' &&
      typeof candidate.name === 'string' &&
      typeof candidate.position === 'number' &&
      typeof candidate.itemCount === 'number' &&
      typeof candidate.createdAt === 'string' &&
      typeof candidate.updatedAt === 'string' &&
      (candidate.emoji === null ||
        candidate.emoji === undefined ||
        typeof candidate.emoji === 'string') &&
      (candidate.color === null ||
        candidate.color === undefined ||
        typeof candidate.color === 'string')
  );
}

function isCollectionItem(value: unknown): value is CollectionItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CollectionItem>;

  return Boolean(
    typeof candidate.id === 'string' &&
      typeof candidate.collectionId === 'string' &&
      typeof candidate.title === 'string' &&
      typeof candidate.position === 'number' &&
      typeof candidate.createdAt === 'string' &&
      typeof candidate.updatedAt === 'string' &&
      (candidate.note === null ||
        candidate.note === undefined ||
        typeof candidate.note === 'string') &&
      (candidate.link === null ||
        candidate.link === undefined ||
        typeof candidate.link === 'string') &&
      (candidate.coverUrl === null ||
        candidate.coverUrl === undefined ||
        typeof candidate.coverUrl === 'string') &&
      (candidate.status === null ||
        candidate.status === undefined ||
        typeof candidate.status === 'string') &&
      (candidate.score === null ||
        candidate.score === undefined ||
        typeof candidate.score === 'number')
  );
}

async function readState(key: string): Promise<StoredState> {
  const rawValue = await AsyncStorage.getItem(key);

  if (!rawValue) {
    return EMPTY;
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return EMPTY;
    }

    const candidate = parsed as Partial<StoredState>;

    return {
      collections: Array.isArray(candidate.collections)
        ? candidate.collections.filter(isCollection)
        : [],
      items: Array.isArray(candidate.items)
        ? candidate.items.filter(isCollectionItem)
        : [],
    };
  } catch {
    return EMPTY;
  }
}

async function writeState(key: string, state: StoredState): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(state));
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function byPosition<T extends { position: number }>(a: T, b: T): number {
  return a.position - b.position;
}

function nextPosition(rows: { position: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
}

/**
 * The stored shelf count is a cache. Recompute it on every read so a stale or
 * hand-edited blob can never show a number the items disagree with.
 */
function withItemCounts(state: StoredState): Collection[] {
  return state.collections
    .map((collection) => ({
      ...collection,
      itemCount: state.items.filter((item) => item.collectionId === collection.id).length,
    }))
    .sort(byPosition);
}

// Validation mirrors the API's zod schemas (trim + min/max) so the stub
// rejects the same inputs the server rejects with a 400 — no silent divergence.
function assertValidName(rawName: string): string {
  const name = rawName.trim();

  if (!name) {
    throw new Error('Lists need a name');
  }
  if (name.length > COLLECTION_NAME_MAX) {
    throw new Error(`List names are limited to ${COLLECTION_NAME_MAX} characters`);
  }

  return name;
}

function normalizeEmoji(rawEmoji: string | null | undefined): string | null {
  if (rawEmoji == null) {
    return null;
  }

  const emoji = rawEmoji.trim();

  if (emoji.length > COLLECTION_EMOJI_MAX) {
    throw new Error(`List emoji are limited to ${COLLECTION_EMOJI_MAX} characters`);
  }

  return emoji ? emoji : null;
}

/** A colour must come from the fixed palette, matching the API's zod enum. */
function normalizeColor(rawColor: string | null | undefined): Collection['color'] {
  if (rawColor == null) {
    return null;
  }

  const color = rawColor.trim();

  if (!(COLLECTION_COLORS as readonly string[]).includes(color)) {
    throw new Error('That list colour is not available');
  }

  return color as Collection['color'];
}

function assertValidTitle(rawTitle: string): string {
  const title = rawTitle.trim();

  if (!title) {
    throw new Error('Items need a title');
  }
  if (title.length > COLLECTION_ITEM_TITLE_MAX) {
    throw new Error(`Item titles are limited to ${COLLECTION_ITEM_TITLE_MAX} characters`);
  }

  return title;
}

function normalizeNote(rawNote: string | null | undefined): string | null {
  if (rawNote == null) {
    return null;
  }

  const note = rawNote.trim();

  if (note.length > COLLECTION_ITEM_NOTE_MAX) {
    throw new Error(`Item notes are limited to ${COLLECTION_ITEM_NOTE_MAX} characters`);
  }

  return note ? note : null;
}

function normalizeLink(rawLink: string | null | undefined): string | null {
  if (rawLink == null) {
    return null;
  }

  const link = rawLink.trim();

  if (link.length > COLLECTION_LINK_MAX) {
    throw new Error(`Item links are limited to ${COLLECTION_LINK_MAX} characters`);
  }

  return link ? link : null;
}

function normalizeCover(rawCover: string | null | undefined): string | null {
  if (rawCover == null) {
    return null;
  }

  const cover = rawCover.trim();

  if (cover.length > COLLECTION_COVER_MAX) {
    throw new Error(`Cover links are limited to ${COLLECTION_COVER_MAX} characters`);
  }

  return cover ? cover : null;
}

/** A status must come from the fixed set, matching the API's zod enum. */
function normalizeStatus(rawStatus: string | null | undefined): CollectionItem['status'] {
  if (rawStatus == null) {
    return null;
  }

  const status = rawStatus.trim();

  if (!(COLLECTION_STATUSES as readonly string[]).includes(status)) {
    throw new Error('That status is not available');
  }

  return status as CollectionItem['status'];
}

/** A score is a whole number out of ten, or nothing. */
function normalizeScore(rawScore: number | null | undefined): number | null {
  if (rawScore == null) {
    return null;
  }

  if (
    !Number.isInteger(rawScore) ||
    rawScore < COLLECTION_SCORE_MIN ||
    rawScore > COLLECTION_SCORE_MAX
  ) {
    throw new Error(`Scores run from ${COLLECTION_SCORE_MIN} to ${COLLECTION_SCORE_MAX}`);
  }

  return rawScore;
}

/**
 * Device-local shelves for stub mode. Unlike Someday (keyed by user), a shelf
 * belongs to the active space, so the storage blob is keyed by space id: two
 * accounts on one device never share a shelf, and the same space persists
 * across sign-ins.
 */
export function createLocalCollectionsRepository(spaceId: string): CollectionsRepository {
  const key = collectionStorageKey(spaceId);

  return {
    async listCollections() {
      return withItemCounts(await readState(key));
    },

    async createCollection(input: CreateCollectionRequest) {
      const name = assertValidName(input.name);
      const emoji = normalizeEmoji(input.emoji);
      const color = normalizeColor(input.color);
      const state = await readState(key);
      const now = new Date().toISOString();

      const collection: Collection = {
        id: createId('collection'),
        name,
        emoji,
        color,
        position: nextPosition(state.collections),
        itemCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      await writeState(key, {
        collections: [...state.collections, collection],
        items: state.items,
      });

      return collection;
    },

    async updateCollection(id, input: UpdateCollectionRequest) {
      const nextName =
        input.name !== undefined ? assertValidName(input.name) : undefined;
      const nextEmoji =
        input.emoji !== undefined ? normalizeEmoji(input.emoji) : undefined;
      const nextColor =
        input.color !== undefined ? normalizeColor(input.color) : undefined;

      const state = await readState(key);
      const index = state.collections.findIndex((collection) => collection.id === id);

      if (index === -1) {
        throw new Error('That list no longer exists');
      }

      const next: Collection = { ...state.collections[index] };

      if (nextName !== undefined) {
        next.name = nextName;
      }
      if (nextEmoji !== undefined) {
        next.emoji = nextEmoji;
      }
      if (nextColor !== undefined) {
        next.color = nextColor;
      }
      if (input.position !== undefined) {
        next.position = input.position;
      }

      next.updatedAt = new Date().toISOString();

      const collections = [...state.collections];
      collections[index] = next;
      await writeState(key, { collections, items: state.items });

      return next;
    },

    async deleteCollection(id) {
      const state = await readState(key);

      await writeState(key, {
        // Soft-delete on the server; the stub simply drops the shelf and its
        // items, which is the same observable outcome.
        collections: state.collections.filter((collection) => collection.id !== id),
        items: state.items.filter((item) => item.collectionId !== id),
      });
    },

    async listItems(collectionId) {
      const state = await readState(key);
      return state.items
        .filter((item) => item.collectionId === collectionId)
        .sort(byPosition);
    },

    async createItem(collectionId, input: CreateCollectionItemRequest) {
      const title = assertValidTitle(input.title);
      const note = normalizeNote(input.note);
      const link = normalizeLink(input.link);
      const coverUrl = normalizeCover(input.coverUrl);
      const status = normalizeStatus(input.status);
      const score = normalizeScore(input.score);

      const state = await readState(key);

      if (!state.collections.some((collection) => collection.id === collectionId)) {
        throw new Error('That list no longer exists');
      }

      const now = new Date().toISOString();
      const item: CollectionItem = {
        id: createId('collection_item'),
        collectionId,
        title,
        note,
        link,
        coverUrl,
        status,
        score,
        position: nextPosition(state.items.filter((row) => row.collectionId === collectionId)),
        createdAt: now,
        updatedAt: now,
      };

      await writeState(key, {
        collections: state.collections,
        items: [...state.items, item],
      });

      return item;
    },

    async updateItem(itemId, input: UpdateCollectionItemRequest) {
      const nextTitle =
        input.title !== undefined ? assertValidTitle(input.title) : undefined;
      const nextNote = input.note !== undefined ? normalizeNote(input.note) : undefined;
      const nextLink = input.link !== undefined ? normalizeLink(input.link) : undefined;
      const nextCover =
        input.coverUrl !== undefined ? normalizeCover(input.coverUrl) : undefined;
      const nextStatus =
        input.status !== undefined ? normalizeStatus(input.status) : undefined;
      const nextScore = input.score !== undefined ? normalizeScore(input.score) : undefined;

      const state = await readState(key);
      const index = state.items.findIndex((item) => item.id === itemId);

      if (index === -1) {
        throw new Error('That item no longer exists');
      }

      const next: CollectionItem = { ...state.items[index] };

      if (nextTitle !== undefined) {
        next.title = nextTitle;
      }
      if (input.note !== undefined) {
        next.note = nextNote;
      }
      if (input.link !== undefined) {
        next.link = nextLink;
      }
      if (input.coverUrl !== undefined) {
        next.coverUrl = nextCover;
      }
      if (input.status !== undefined) {
        next.status = nextStatus;
      }
      if (input.score !== undefined) {
        next.score = nextScore;
      }
      if (input.position !== undefined) {
        next.position = input.position;
      }

      next.updatedAt = new Date().toISOString();

      const items = [...state.items];
      items[index] = next;
      await writeState(key, { collections: state.collections, items });

      return next;
    },

    async deleteItem(itemId) {
      const state = await readState(key);

      await writeState(key, {
        collections: state.collections,
        items: state.items.filter((item) => item.id !== itemId),
      });
    },
  };
}
