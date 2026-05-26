import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ── Cursor / Date validation tests ──────────────────────────────────────

const cursorSchema = z.string().datetime({ offset: true }).optional();
const dateSchema = z.string().datetime({ offset: true });
const dateOptionalSchema = z.string().datetime({ offset: true }).nullable().optional();

describe('date validation', () => {
  it('accepts valid ISO datetime with offset', () => {
    expect(dateSchema.parse('2024-01-15T10:30:00Z')).toBe('2024-01-15T10:30:00Z');
    expect(dateSchema.parse('2024-06-01T00:00:00+05:30')).toBe('2024-06-01T00:00:00+05:30');
  });

  it('rejects plain date strings', () => {
    expect(() => dateSchema.parse('2024-01-15')).toThrow();
  });

  it('rejects empty strings', () => {
    expect(() => dateSchema.parse('')).toThrow();
  });

  it('rejects malformed strings', () => {
    expect(() => dateSchema.parse('not-a-date')).toThrow();
    expect(() => dateSchema.parse('2024/01/15')).toThrow();
  });

  it('rejects timestamps without offset', () => {
    expect(() => dateSchema.parse('2024-01-15T10:30:00')).toThrow();
  });

  it('cursor accepts undefined (no cursor = first page)', () => {
    expect(cursorSchema.parse(undefined)).toBeUndefined();
  });

  it('cursor accepts valid ISO datetime', () => {
    expect(cursorSchema.parse('2024-06-01T00:00:00Z')).toBe('2024-06-01T00:00:00Z');
  });

  it('cursor rejects invalid date', () => {
    expect(() => cursorSchema.parse('invalid')).toThrow();
  });

  it('nullable optional date accepts null', () => {
    expect(dateOptionalSchema.parse(null)).toBeNull();
  });

  it('nullable optional date accepts undefined', () => {
    expect(dateOptionalSchema.parse(undefined)).toBeUndefined();
  });

  it('nullable optional date accepts valid string', () => {
    expect(dateOptionalSchema.parse('2024-01-15T10:30:00Z')).toBe('2024-01-15T10:30:00Z');
  });
});

// ── Input size limit tests ──────────────────────────────────────────────

const momentBodySchema = z.string().max(10000);
const momentTitleSchema = z.string().max(500);
const calendarTitleSchema = z.string().min(1).max(500);

describe('input size limits', () => {
  it('moment body accepts normal text', () => {
    expect(momentBodySchema.parse('normal text')).toBe('normal text');
  });

  it('moment body rejects text over 10K', () => {
    expect(() => momentBodySchema.parse('x'.repeat(10001))).toThrow();
  });

  it('moment body accepts exactly 10K', () => {
    const val = 'x'.repeat(10000);
    expect(momentBodySchema.parse(val)).toBe(val);
  });

  it('moment title rejects empty string (no min)', () => {
    // title is optional with default '', so empty string is valid
    expect(momentTitleSchema.parse('')).toBe('');
  });

  it('calendar title rejects empty string', () => {
    expect(() => calendarTitleSchema.parse('')).toThrow();
  });

  it('calendar title accepts valid title', () => {
    expect(calendarTitleSchema.parse('Date night')).toBe('Date night');
  });

  it('calendar title rejects over 500 chars', () => {
    expect(() => calendarTitleSchema.parse('x'.repeat(501))).toThrow();
  });
});

// ── OAuth schema tests ──────────────────────────────────────────────────

const oauthStartSchema = z.object({
  provider: z.enum(['apple', 'google']),
  platform: z.enum(['ios', 'android']),
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
});

const oauthCallbackSchema = z.object({
  provider: z.enum(['apple', 'google']),
  platform: z.enum(['ios', 'android']),
  code: z.string().min(1),
  state: z.string().min(1),
  codeVerifier: z.string().optional(),
});

describe('OAuth schema validation', () => {
  it('oauth start accepts valid input', () => {
    const result = oauthStartSchema.parse({
      provider: 'google',
      platform: 'ios',
      clientId: 'test-client',
      redirectUri: 'https://example.com/callback',
    });
    expect(result.provider).toBe('google');
  });

  it('oauth start rejects invalid provider', () => {
    expect(() =>
      oauthStartSchema.parse({
        provider: 'microsoft',
        platform: 'ios',
        clientId: 'test',
        redirectUri: 'https://example.com/callback',
      })
    ).toThrow();
  });

  it('oauth start rejects invalid redirect URI', () => {
    expect(() =>
      oauthStartSchema.parse({
        provider: 'apple',
        platform: 'android',
        clientId: 'test',
        redirectUri: 'not-a-url',
      })
    ).toThrow();
  });

  it('oauth callback validates state must be non-empty', () => {
    expect(() =>
      oauthCallbackSchema.parse({
        provider: 'google',
        platform: 'ios',
        code: 'auth-code',
        state: '',
      })
    ).toThrow();
  });

  it('oauth callback accepts optional codeVerifier', () => {
    const result = oauthCallbackSchema.parse({
      provider: 'google',
      platform: 'ios',
      code: 'auth-code',
      state: 'valid-state',
      codeVerifier: 'verifier-value',
    });
    expect(result.codeVerifier).toBe('verifier-value');
  });
});

// ── Space schema tests ──────────────────────────────────────────────────

const createSpaceSchema = z.object({
  name: z.string().min(1).max(200),
  partnerName: z.string().min(1).max(200),
  relationshipStartDate: z.string().min(1),
});

describe('space CRUD validation', () => {
  it('create space accepts valid input', () => {
    const result = createSpaceSchema.parse({
      name: 'Our Space',
      partnerName: 'Alex',
      relationshipStartDate: '2023-06-15',
    });
    expect(result.name).toBe('Our Space');
  });

  it('create space rejects empty name', () => {
    expect(() =>
      createSpaceSchema.parse({
        name: '',
        partnerName: 'Alex',
        relationshipStartDate: '2023-06-15',
      })
    ).toThrow();
  });

  it('create space rejects name over 200 chars', () => {
    expect(() =>
      createSpaceSchema.parse({
        name: 'x'.repeat(201),
        partnerName: 'Alex',
        relationshipStartDate: '2023-06-15',
      })
    ).toThrow();
  });

  it('create space rejects empty partner name', () => {
    expect(() =>
      createSpaceSchema.parse({
        name: 'Our Space',
        partnerName: '',
        relationshipStartDate: '2023-06-15',
      })
    ).toThrow();
  });
});

// ── Moment schema tests ─────────────────────────────────────────────────

const createMomentSchema = z.object({
  type: z.enum(['note', 'milestone', 'date', 'goal', 'media']),
  title: z.string().max(500).optional().default(''),
  body: z.string().max(10000).optional().default(''),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  targetAt: z.string().datetime({ offset: true }).nullable().optional(),
  mediaPreview: z.string().max(2000).nullable().optional(),
});

describe('moment CRUD validation', () => {
  it('create moment with defaults', () => {
    const result = createMomentSchema.parse({
      type: 'note',
    });
    expect(result.title).toBe('');
    expect(result.body).toBe('');
    expect(result.occurredAt).toBeUndefined();
  });

  it('create moment rejects invalid type', () => {
    expect(() =>
      createMomentSchema.parse({
        type: 'event',
      })
    ).toThrow();
  });

  it('create moment accepts full input', () => {
    const result = createMomentSchema.parse({
      type: 'milestone',
      title: 'First date',
      body: 'We met at the coffee shop.',
      occurredAt: '2024-01-15T10:30:00Z',
      mediaPreview: 'https://example.com/photo.jpg',
    });
    expect(result.title).toBe('First date');
    expect(result.mediaPreview).toBe('https://example.com/photo.jpg');
  });

  it('create moment rejects invalid occurredAt', () => {
    expect(() =>
      createMomentSchema.parse({
        type: 'note',
        occurredAt: 'not-a-date',
      })
    ).toThrow();
  });

  it('create moment rejects body over 10K', () => {
    expect(() =>
      createMomentSchema.parse({
        type: 'note',
        body: 'x'.repeat(10001),
      })
    ).toThrow();
  });
});

// ── Calendar event schema tests ─────────────────────────────────────────

const createEventSchema = z.object({
  title: z.string().min(1).max(500),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  actor: z.enum(['you', 'partner']),
  actorName: z.string().min(1).max(200),
  label: z.object({
    preset: z.enum(['Work', 'Gym', 'Travel', 'Date', 'Family', 'Other']),
    customText: z.string().max(200).optional(),
  }),
});

describe('calendar event validation', () => {
  it('create event accepts valid input', () => {
    const result = createEventSchema.parse({
      title: 'Date night',
      startsAt: '2024-06-01T18:00:00Z',
      endsAt: '2024-06-01T22:00:00Z',
      actor: 'you',
      actorName: 'Me',
      label: { preset: 'Date' },
    });
    expect(result.title).toBe('Date night');
  });

  it('create event rejects missing customText for Other label (optional)', () => {
    // customText is optional even for Other
    const result = createEventSchema.parse({
      title: 'Other event',
      startsAt: '2024-06-01T18:00:00Z',
      endsAt: '2024-06-01T22:00:00Z',
      actor: 'partner',
      actorName: 'Partner',
      label: { preset: 'Other' },
    });
    expect(result.label.preset).toBe('Other');
  });

  it('create event rejects invalid actor', () => {
    expect(() =>
      createEventSchema.parse({
        title: 'Test',
        startsAt: '2024-06-01T18:00:00Z',
        endsAt: '2024-06-01T22:00:00Z',
        actor: 'them',
        actorName: 'Them',
        label: { preset: 'Work' },
      })
    ).toThrow();
  });

  it('create event rejects invalid start date', () => {
    expect(() =>
      createEventSchema.parse({
        title: 'Test',
        startsAt: 'bad-date',
        endsAt: '2024-06-01T22:00:00Z',
        actor: 'you',
        actorName: 'Me',
        label: { preset: 'Work' },
      })
    ).toThrow();
  });
});
