import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LETTER_BODY_MAX_LENGTH,
  LETTER_CAPTION_MAX_LENGTH,
  LETTER_SEAL_MAX_HORIZON_DAYS,
  sortLettersNewestFirst,
  type Letter,
  type LetterAuthorRole,
} from '@aoi/shared';

import type { LettersRepository, SealLetterInput } from '@/features/letters/types';

const STORAGE_KEY_PREFIX = 'aoi.letters.v1.';

/**
 * Stub mode simulates ONE partner letter, plainly documented: it is sealed
 * about fifteen seconds after first load so the opening reveal can be tried
 * offline. It is obviously synthetic (the body says so); remote mode carries
 * the couple's real words instead.
 */
const STUB_PARTNER_LETTER_ID = 'letters_stub_partner_seed';
const STUB_PARTNER_SEAL_DELAY_MS = 15_000;

const STUB_PARTNER_LETTER_BODY =
  'This is a pretend letter from your partner, sealed a few seconds ago so ' +
  'you can try the reveal. In your real space, these will be their own ' +
  'words, sealed away until the day arrives.';

/**
 * Device-local storage keeps the body of every letter (it has to live
 * somewhere in stub mode), but the repository contract mirrors the server:
 * `list` never returns the body of an unopened letter — not even to its
 * author — and only `open` releases it.
 */
type StoredLetter = {
  id: string;
  authorRole: LetterAuthorRole;
  authorName: string;
  caption: string | null;
  /** The sealed-away words; never surfaced until the letter is opened. */
  storedBody: string;
  sealedUntil: string;
  createdAt: string;
  openedAt: string | null;
};

type StoredLettersPayload = {
  seededAt: string;
  letters: StoredLetter[];
};

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function isStoredLetter(value: unknown): value is StoredLetter {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<StoredLetter>;

  return Boolean(
    typeof candidate.id === 'string' &&
      (candidate.authorRole === 'you' || candidate.authorRole === 'partner') &&
      typeof candidate.authorName === 'string' &&
      typeof candidate.storedBody === 'string' &&
      typeof candidate.sealedUntil === 'string' &&
      typeof candidate.createdAt === 'string' &&
      (candidate.openedAt === null || typeof candidate.openedAt === 'string')
  );
}

async function readPayload(key: string): Promise<StoredLettersPayload | null> {
  const rawValue = await AsyncStorage.getItem(key);

  if (!rawValue) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as StoredLettersPayload).seededAt !== 'string' ||
      !Array.isArray((parsed as StoredLettersPayload).letters)
    ) {
      return null;
    }

    const payload = parsed as StoredLettersPayload;

    return {
      seededAt: payload.seededAt,
      letters: payload.letters.filter(isStoredLetter),
    };
  } catch {
    return null;
  }
}

async function writePayload(key: string, payload: StoredLettersPayload): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(payload));
}

function createPartnerSeedLetter(seededAt: Date): StoredLetter {
  return {
    id: STUB_PARTNER_LETTER_ID,
    authorRole: 'partner',
    authorName: 'Them',
    caption: 'For a quiet day',
    storedBody: STUB_PARTNER_LETTER_BODY,
    sealedUntil: new Date(seededAt.getTime() + STUB_PARTNER_SEAL_DELAY_MS).toISOString(),
    createdAt: seededAt.toISOString(),
    openedAt: null,
  };
}

function toApi(stored: StoredLetter, now: Date): Letter {
  const isOpened = stored.openedAt !== null;
  const sealedUntil = new Date(stored.sealedUntil);

  const letter: Letter = {
    id: stored.id,
    authorRole: stored.authorRole,
    authorName: stored.authorName,
    caption: stored.caption,
    sealedUntil: stored.sealedUntil,
    createdAt: stored.createdAt,
    isOpened,
    readyToOpen:
      !Number.isNaN(sealedUntil.getTime()) && now.getTime() >= sealedUntil.getTime(),
    openedAt: stored.openedAt,
  };

  // The same lock the server enforces: no body leaves an unopened letter.
  if (isOpened) {
    letter.body = stored.storedBody;
  }

  return letter;
}

function createId(): string {
  return `letter_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Mirrors the API's validation (same word-only messages) so the stub
// rejects exactly what the server rejects with a 400.
function assertValidSealInput(input: SealLetterInput): {
  body: string;
  caption: string | null;
  sealedUntil: Date;
} {
  const body = input.body.trim();

  if (!body) {
    throw new Error('A letter needs a few words');
  }
  if (body.length > LETTER_BODY_MAX_LENGTH) {
    throw new Error('That letter is a little too long to seal');
  }

  const caption = input.caption?.trim() ?? '';
  if (caption.length > LETTER_CAPTION_MAX_LENGTH) {
    throw new Error('Keep the caption to a few words');
  }

  const sealedUntil = new Date(input.sealedUntil);
  if (Number.isNaN(sealedUntil.getTime())) {
    throw new Error("That opening day doesn't look quite right");
  }

  const now = new Date();
  if (!(sealedUntil.getTime() > now.getTime())) {
    throw new Error('A letter can only open in the future');
  }
  if (sealedUntil.getTime() > now.getTime() + LETTER_SEAL_MAX_HORIZON_DAYS * DAY_MS) {
    throw new Error("That's farther away than letters can wait");
  }

  return { body, caption: caption || null, sealedUntil };
}

/**
 * Device-local letters for stub mode. Storage is keyed per user
 * (single-author on one device, like the Someday list). The partner letter
 * seeded here exists only so the reveal ceremony can be felt offline.
 */
export function createLocalLettersRepository(userId: string): LettersRepository {
  const key = storageKey(userId);

  async function loadOrCreate(): Promise<StoredLettersPayload> {
    const existing = await readPayload(key);

    if (existing) {
      return existing;
    }

    const seeded: StoredLettersPayload = {
      seededAt: new Date().toISOString(),
      letters: [createPartnerSeedLetter(new Date())],
    };

    await writePayload(key, seeded);
    return seeded;
  }

  return {
    async list() {
      const payload = await loadOrCreate();
      const now = new Date();

      return sortLettersNewestFirst(
        payload.letters.map((stored) => toApi(stored, now))
      );
    },

    async seal(input) {
      const valid = assertValidSealInput(input);
      const payload = await loadOrCreate();
      const now = new Date();

      const stored: StoredLetter = {
        id: createId(),
        authorRole: 'you',
        authorName: 'You',
        caption: valid.caption,
        storedBody: valid.body,
        sealedUntil: valid.sealedUntil.toISOString(),
        createdAt: now.toISOString(),
        openedAt: null,
      };

      await writePayload(key, { ...payload, letters: [stored, ...payload.letters] });
      return toApi(stored, now);
    },

    async open(letterId) {
      const payload = await loadOrCreate();
      const now = new Date();
      const stored = payload.letters.find((letter) => letter.id === letterId);

      if (!stored) {
        throw new Error('Letter not found');
      }

      if (stored.openedAt !== null) {
        // Already open — reading it again is quiet and idempotent.
        return toApi(stored, now);
      }

      const sealedUntil = new Date(stored.sealedUntil);
      if (Number.isNaN(sealedUntil.getTime()) || now.getTime() < sealedUntil.getTime()) {
        throw new Error('Not yet time');
      }

      const opened: StoredLetter = { ...stored, openedAt: now.toISOString() };
      await writePayload(key, {
        ...payload,
        letters: payload.letters.map((letter) =>
          letter.id === letterId ? opened : letter
        ),
      });

      return toApi(opened, now);
    },
  };
}
