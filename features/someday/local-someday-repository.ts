import AsyncStorage from '@react-native-async-storage/async-storage';
import { sortSomedayItems } from '@aoi/shared';

import {
  SOMEDAY_CATEGORIES,
  SOMEDAY_NOTE_MAX_LENGTH,
  SOMEDAY_TITLE_MAX_LENGTH,
  type CreateSomedayItemInput,
  type SomedayItem,
  type SomedayRepository,
} from '@/features/someday/types';

const STORAGE_KEY_PREFIX = 'aoi.someday.v1.';

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function isSomedayCategory(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (SOMEDAY_CATEGORIES as readonly string[]).includes(value)
  );
}

function isSomedayItem(value: unknown): value is SomedayItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SomedayItem>;

  return Boolean(
    typeof candidate.id === 'string' &&
      typeof candidate.title === 'string' &&
      typeof candidate.createdAt === 'string' &&
      (candidate.checkedAt === null ||
        candidate.checkedAt === undefined ||
        typeof candidate.checkedAt === 'string') &&
      (candidate.createdByRole === 'you' || candidate.createdByRole === 'partner') &&
      isSomedayCategory(candidate.category)
  );
}

function normalizeItem(item: SomedayItem): SomedayItem {
  return {
    ...item,
    checkedAt: item.checkedAt ?? null,
    checkedByRole: item.checkedAt ? item.checkedByRole ?? null : null,
  };
}

async function readItems(key: string): Promise<SomedayItem[]> {
  const rawValue = await AsyncStorage.getItem(key);

  if (!rawValue) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isSomedayItem).map(normalizeItem);
  } catch {
    return [];
  }
}

async function writeItems(key: string, items: SomedayItem[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(items));
}

function createId(): string {
  return `someday_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

// Mirrors the API's zod validation (trim + min/max) so the stub rejects the
// same inputs the server rejects with a 400 — no silent divergence.
function assertValidTitle(rawTitle: string): string {
  const title = rawTitle.trim();

  if (!title) {
    throw new Error('Someday items need a title');
  }
  if (title.length > SOMEDAY_TITLE_MAX_LENGTH) {
    throw new Error(
      `Someday titles are limited to ${SOMEDAY_TITLE_MAX_LENGTH} characters`
    );
  }

  return title;
}

function assertValidNote(rawNote: string | undefined): string | undefined {
  if (rawNote === undefined) {
    return undefined;
  }

  const note = rawNote.trim();

  if (note.length > SOMEDAY_NOTE_MAX_LENGTH) {
    throw new Error(
      `Someday notes are limited to ${SOMEDAY_NOTE_MAX_LENGTH} characters`
    );
  }

  return note ? note : undefined;
}

/**
 * Device-local Someday list for stub mode. A single device means a single
 * author, so new items and check-offs are always attributed to "you"; the
 * remote repository gets real per-user attribution from the API.
 */
export function createLocalSomedayRepository(userId: string): SomedayRepository {
  const key = storageKey(userId);

  return {
    async list() {
      return sortSomedayItems(await readItems(key));
    },

    async add(input: CreateSomedayItemInput) {
      const title = assertValidTitle(input.title);
      const note = assertValidNote(input.note);

      const item: SomedayItem = {
        id: createId(),
        title,
        note,
        category: input.category ?? 'other',
        createdByRole: 'you',
        createdAt: new Date().toISOString(),
        checkedAt: null,
        checkedByRole: null,
      };

      const items = await readItems(key);
      await writeItems(key, [item, ...items]);
      return item;
    },

    async update(itemId, input) {
      // Validation mirrors the API's PATCH schema and runs first, exactly
      // like the server's zod validator: a blank or oversized title/note
      // rejects with a throw instead of the server's 400.
      const nextTitle =
        input.title !== undefined ? assertValidTitle(input.title) : undefined;
      const nextNote =
        input.note !== undefined ? assertValidNote(input.note) : undefined;

      const items = await readItems(key);
      const index = items.findIndex((item) => item.id === itemId);

      if (index === -1) {
        return null;
      }

      const next: SomedayItem = { ...items[index] };

      if (nextTitle !== undefined) {
        next.title = nextTitle;
      }
      if (input.note !== undefined) {
        next.note = nextNote;
      }
      if (input.category !== undefined) {
        next.category = input.category;
      }
      // Only meaningful transitions write: re-checking a checked item (or
      // undoing an open one) keeps the existing state untouched.
      if (input.checked === true && next.checkedAt === null) {
        next.checkedAt = new Date().toISOString();
        next.checkedByRole = 'you';
      }
      if (input.checked === false && next.checkedAt !== null) {
        next.checkedAt = null;
        next.checkedByRole = null;
      }

      const nextItems = [...items];
      nextItems[index] = next;
      await writeItems(key, nextItems);
      return next;
    },
  };
}
