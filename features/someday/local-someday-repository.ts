import AsyncStorage from '@react-native-async-storage/async-storage';

import { sortSomedayItems } from '@/features/someday/someday-order';
import {
  SOMEDAY_CATEGORIES,
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
      const title = input.title.trim();

      if (!title) {
        throw new Error('Someday items need a title');
      }

      const note = input.note?.trim();
      const item: SomedayItem = {
        id: createId(),
        title,
        note: note ? note : undefined,
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
      const items = await readItems(key);
      const index = items.findIndex((item) => item.id === itemId);

      if (index === -1) {
        return null;
      }

      const next: SomedayItem = { ...items[index] };

      if (input.title !== undefined) {
        const title = input.title.trim();
        if (title) {
          next.title = title;
        }
      }
      if (input.note !== undefined) {
        const note = input.note.trim();
        next.note = note ? note : undefined;
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
