import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LETTER_BODY_MAX_LENGTH, LETTER_CAPTION_MAX_LENGTH } from '@aoi/shared';

import { createLocalLettersRepository } from '@/features/letters/local-letters-repository';

// Fixed clock so seed timing and seal validation are deterministic.
const FIXED_NOW = new Date('2026-08-03T12:00:00.000Z');
const FUTURE_SEAL = new Date('2026-09-03T09:00:00.000Z');

const SECRET_BODY = 'These words are sealed away.';

function wordOnly(message: string): boolean {
  return !/\d/.test(message);
}

beforeEach(() => {
  globalThis.__mockAsyncStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('local letters repository (stub mode)', () => {
  it('seeds one plainly-simulated partner letter on first load', async () => {
    const repo = createLocalLettersRepository('user-local-1');
    const letters = await repo.list();

    expect(letters).toHaveLength(1);
    const seeded = letters[0];
    expect(seeded.authorRole).toBe('partner');
    expect(seeded.isOpened).toBe(false);
    expect(seeded.body).toBeUndefined();
    // Sealed about fifteen seconds from first load so the reveal can be tried.
    const due = new Date(seeded.sealedUntil).getTime();
    expect(due - FIXED_NOW.getTime()).toBe(15_000);
  });

  it('seeds once — a second repository for the same user sees the same shelf', async () => {
    const first = createLocalLettersRepository('user-local-2');
    const initial = await first.list();

    const second = createLocalLettersRepository('user-local-2');
    const again = await second.list();

    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(initial[0].id);
  });

  it('keeps shelves separate per user', async () => {
    const one = createLocalLettersRepository('user-local-3');
    await one.seal({ body: 'For you', sealedUntil: FUTURE_SEAL.toISOString() });

    const other = createLocalLettersRepository('user-local-4');
    const theirs = await other.list();

    expect(theirs).toHaveLength(1); // only the simulated partner seed
    expect(theirs[0].authorRole).toBe('partner');
  });

  it('seals a letter without ever handing back the words', async () => {
    const repo = createLocalLettersRepository('user-local-5');

    const sealed = await repo.seal({
      caption: 'For a future day',
      body: SECRET_BODY,
      sealedUntil: FUTURE_SEAL.toISOString(),
    });

    expect(sealed.authorRole).toBe('you');
    expect(sealed.isOpened).toBe(false);
    expect(sealed.body).toBeUndefined();
    expect(JSON.stringify(sealed)).not.toContain(SECRET_BODY);
  });

  it('omits the body of every unopened letter in the list — for the author too', async () => {
    const repo = createLocalLettersRepository('user-local-6');
    await repo.seal({ body: SECRET_BODY, sealedUntil: FUTURE_SEAL.toISOString() });

    const letters = await repo.list();
    const own = letters.find((letter) => letter.authorRole === 'you');

    expect(own).toBeDefined();
    expect(own!.body).toBeUndefined();
    expect(JSON.stringify(letters)).not.toContain(SECRET_BODY);
  });

  it('lists letters newest first', async () => {
    const repo = createLocalLettersRepository('user-local-7');
    await repo.seal({ body: 'First', sealedUntil: FUTURE_SEAL.toISOString() });
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 60_000));
    await repo.seal({ body: 'Second', sealedUntil: FUTURE_SEAL.toISOString() });

    const letters = await repo.list();
    expect(letters).toHaveLength(3); // partner seed + two sealed
    expect(letters[0].authorRole).toBe('you');
    expect(letters[0].createdAt > letters[1].createdAt).toBe(true);
  });

  describe('seal validation mirrors the server (word-only)', () => {
    it('rejects an empty body', async () => {
      const repo = createLocalLettersRepository('user-local-8');
      await expect(
        repo.seal({ body: '   ', sealedUntil: FUTURE_SEAL.toISOString() })
      ).rejects.toThrow('A letter needs a few words');
    });

    it('rejects an over-long body', async () => {
      const repo = createLocalLettersRepository('user-local-9');
      const tooLong = 'a'.repeat(LETTER_BODY_MAX_LENGTH + 1);
      await expect(
        repo.seal({ body: tooLong, sealedUntil: FUTURE_SEAL.toISOString() })
      ).rejects.toThrow('That letter is a little too long to seal');
    });

    it('rejects an over-long caption', async () => {
      const repo = createLocalLettersRepository('user-local-10');
      const tooLong = 'c'.repeat(LETTER_CAPTION_MAX_LENGTH + 1);
      await expect(
        repo.seal({ caption: tooLong, body: 'A few words', sealedUntil: FUTURE_SEAL.toISOString() })
      ).rejects.toThrow('Keep the caption to a few words');
    });

    it('rejects a seal day in the past', async () => {
      const repo = createLocalLettersRepository('user-local-11');
      const past = new Date('2026-08-01T09:00:00.000Z');
      await expect(
        repo.seal({ body: 'A few words', sealedUntil: past.toISOString() })
      ).rejects.toThrow('A letter can only open in the future');
    });

    it('rejects a seal day beyond the horizon', async () => {
      const repo = createLocalLettersRepository('user-local-12');
      const farAway = new Date('2100-01-01T09:00:00.000Z');
      await expect(
        repo.seal({ body: 'A few words', sealedUntil: farAway.toISOString() })
      ).rejects.toThrow("That's farther away than letters can wait");
    });

    it('rejects an unparseable seal day', async () => {
      const repo = createLocalLettersRepository('user-local-13');
      await expect(
        repo.seal({ body: 'A few words', sealedUntil: 'not-a-date' })
      ).rejects.toThrow("That opening day doesn't look quite right");
    });

    it('never echoes numbers or dates in rejection messages', async () => {
      const repo = createLocalLettersRepository('user-local-14');
      const inputs = [
        { body: '', sealedUntil: FUTURE_SEAL.toISOString() },
        { body: 'ok', sealedUntil: 'not-a-date' },
        { body: 'ok', sealedUntil: '2026-08-01T09:00:00.000Z' },
        { body: 'ok', sealedUntil: '2100-01-01T09:00:00.000Z' },
      ];

      for (const input of inputs) {
        let caught: unknown = null;
        try {
          await repo.seal(input);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
        expect(wordOnly((caught as Error).message)).toBe(true);
      }
    });
  });

  describe('opening', () => {
    it('refuses to open before the seal day', async () => {
      const repo = createLocalLettersRepository('user-local-15');
      const sealed = await repo.seal({
        body: SECRET_BODY,
        sealedUntil: FUTURE_SEAL.toISOString(),
      });

      await expect(repo.open(sealed.id)).rejects.toThrow('Not yet time');
    });

    it('throws for an unknown letter', async () => {
      const repo = createLocalLettersRepository('user-local-16');
      await expect(repo.open('missing-letter')).rejects.toThrow('Letter not found');
    });

    it('releases the words once the day arrives, and only then', async () => {
      const repo = createLocalLettersRepository('user-local-17');
      const letters = await repo.list();
      const sealed = letters[0]; // the simulated partner letter: due in 15s

      await expect(repo.open(sealed.id)).rejects.toThrow('Not yet time');

      // The seal day arrives.
      vi.setSystemTime(new Date(FIXED_NOW.getTime() + 16_000));
      const opened = await repo.open(sealed.id);

      expect(opened.isOpened).toBe(true);
      expect(opened.authorRole).toBe('partner');
      expect(opened.body).toBeDefined();
      expect(opened.openedAt).not.toBeNull();
      expect(opened.body).toContain('pretend letter from your partner');

      // The shelf now carries the words for good.
      const after = await repo.list();
      expect(after[0].body).toBe(opened.body);
    });

    it('opening again is quiet and idempotent', async () => {
      const repo = createLocalLettersRepository('user-local-18');
      const sealed = await repo.seal({
        body: SECRET_BODY,
        sealedUntil: FUTURE_SEAL.toISOString(),
      });
      vi.setSystemTime(FUTURE_SEAL);

      const first = await repo.open(sealed.id);
      const second = await repo.open(sealed.id);

      expect(second.body).toBe(SECRET_BODY);
      expect(second.openedAt).toBe(first.openedAt);
    });
  });
});
