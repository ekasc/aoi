import { describe, expect, it } from 'vitest';

import {
  calendarLabelSchema,
  createMomentRequestSchema,
  createProposalRequestSchema,
  createSpaceRequestSchema,
  eventProposalSchema,
  isAllowedMediaMimeType,
  isExpoPushToken,
  letterSchema,
  locationShareRequestSchema,
  mediaObjectUrl,
  mediaUploadIntentRequestSchema,
  momentSchema,
  parsePushNotificationData,
  proposalListResponseSchema,
  pushNotificationDataSchema,
  sealLetterRequestSchema,
  sortLettersNewestFirst,
  sortProposalsNewestFirst,
  sortSomedayItems,
  spaceSchema,
  userSchema,
  weeklyQuestionResponseSchema,
} from '../index';

describe('user contract', () => {
  it('parses a canonical user payload', () => {
    const parsed = userSchema.parse({
      id: 'u1',
      email: 'a@b.co',
      displayName: 'Ada',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.displayName).toBe('Ada');
  });

  it('accepts an optional avatarUrl', () => {
    const parsed = userSchema.parse({
      id: 'u1',
      email: 'a@b.co',
      displayName: 'Ada',
      avatarUrl: 'https://img/ada.png',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.avatarUrl).toBe('https://img/ada.png');
  });
});

describe('space contract', () => {
  it('accepts YYYY-MM-DD relationship dates only', () => {
    expect(createSpaceRequestSchema.safeParse({
      name: 'us',
      partnerName: 'B',
      relationshipStartDate: '2024-06-01',
    }).success).toBe(true);

    // The client bug this contract exists to catch: toISOString() output.
    expect(createSpaceRequestSchema.safeParse({
      name: 'us',
      partnerName: 'B',
      relationshipStartDate: '2024-06-01T00:00:00.000Z',
    }).success).toBe(false);
  });

  it('accepts omitted partner name / start date, rejects empty sentinels', () => {
    expect(createSpaceRequestSchema.safeParse({ name: 'us' }).success).toBe(true);
    expect(
      createSpaceRequestSchema.safeParse({ name: 'us', partnerName: 'B' }).success
    ).toBe(true);
    expect(
      createSpaceRequestSchema.safeParse({ name: 'us', relationshipStartDate: '2024-06-01' }).success
    ).toBe(true);
    // Absence is omission — never ''.
    expect(
      createSpaceRequestSchema.safeParse({ name: 'us', partnerName: '' }).success
    ).toBe(false);
    expect(
      createSpaceRequestSchema.safeParse({ name: 'us', relationshipStartDate: '' }).success
    ).toBe(false);
  });
  it('parses the space response shape, including null absence', () => {
    const parsed = spaceSchema.parse({
      id: 's1',
      name: 'us',
      createdByUserId: 'u1',
      partnerName: 'B',
      relationshipStartDate: '2024-06-01',
      inviteCode: 'ABCDEF',
      partnerJoined: true,
      inviteExpiresAt: '2026-02-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.inviteCode).toBe('ABCDEF');
    expect(parsed.partnerJoined).toBe(true);

    const absent = spaceSchema.parse({
      id: 's1',
      name: 'us',
      createdByUserId: 'u1',
      partnerName: null,
      relationshipStartDate: null,
      inviteCode: 'ABCDEF',
      partnerJoined: false,
      inviteExpiresAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(absent.partnerName).toBeNull();
    expect(absent.relationshipStartDate).toBeNull();
  });
});

describe('calendar label union', () => {
  it('accepts a preset without custom text', () => {
    expect(calendarLabelSchema.safeParse({ preset: 'Date' }).success).toBe(true);
  });

  it('accepts Other with custom text', () => {
    expect(calendarLabelSchema.safeParse({ preset: 'Other', customText: 'Beach' }).success).toBe(true);
  });

  it('rejects a preset carrying custom text', () => {
    expect(calendarLabelSchema.safeParse({ preset: 'Work', customText: 'x' }).success).toBe(false);
  });

  it('accepts Other without custom text (server serializes label-less accepts this way)', () => {
    expect(calendarLabelSchema.safeParse({ preset: 'Other' }).success).toBe(true);
  });

  it('rejects Other with an empty custom text', () => {
    expect(calendarLabelSchema.safeParse({ preset: 'Other', customText: '' }).success).toBe(false);
  });

  it('rejects an unknown preset', () => {
    expect(calendarLabelSchema.safeParse({ preset: 'Party' }).success).toBe(false);
  });
});

describe('moment contract', () => {
  it('parses the response shape with isOwn', () => {
    const parsed = momentSchema.parse({
      id: 'm1',
      type: 'note',
      title: 't',
      body: '',
      occurredAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      authorId: 'u1',
      authorRole: 'you',
      authorName: 'You',
      isOwn: true,
    });
    expect(parsed.isOwn).toBe(true);
    expect(parsed.targetAt).toBeUndefined();
  });

  it('accepts an optional clientId idempotency key (bounded length)', () => {
    expect(createMomentRequestSchema.safeParse({
      type: 'note',
      clientId: 'draft-abc',
    }).success).toBe(true);

    expect(createMomentRequestSchema.safeParse({
      type: 'note',
      clientId: 'x'.repeat(65),
    }).success).toBe(false);
  });
});

describe('letter contract', () => {
  it('allows a body-less (locked) letter and an opened letter with body', () => {
    const base = {
      id: 'l1',
      authorRole: 'partner',
      authorName: 'B',
      caption: null,
      sealedUntil: '2030-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      isOpened: false,
      readyToOpen: false,
      openedAt: null,
    };
    expect(letterSchema.safeParse(base).success).toBe(true);
    expect(letterSchema.safeParse({ ...base, isOpened: true, body: 'secret' }).success).toBe(true);
  });
});

describe('proposal contract', () => {
  it('parses proposals with and without labels', () => {
    const parsed = proposalListResponseSchema.parse({
      proposals: [
        {
          id: 'p1',
          proposerRole: 'you',
          proposerName: 'You',
          title: 'Dinner?',
          proposedStart: '2026-02-01T19:00:00.000Z',
          proposedEnd: '2026-02-01T21:00:00.000Z',
          status: 'pending',
          createdAt: '2026-01-01T00:00:00.000Z',
          resolvedAt: null,
        },
      ],
    });
    expect(parsed.proposals[0].status).toBe('pending');
  });

  it('enforces the proposal title length', () => {
    expect(createProposalRequestSchema.safeParse({
      title: 'x'.repeat(121),
      proposedStart: '2026-02-01T19:00:00.000Z',
      proposedEnd: '2026-02-01T21:00:00.000Z',
    }).success).toBe(false);
  });
});

describe('push helpers', () => {
  it('recognizes current and legacy Expo token formats', () => {
    expect(isExpoPushToken('ExpoPushToken[AbCdEf12_345]')).toBe(true);
    expect(isExpoPushToken('ExponentPushToken[xyz-abc]')).toBe(true);
    expect(isExpoPushToken('not-a-token')).toBe(false);
  });

  it('narrows push data to known kinds only', () => {
    expect(parsePushNotificationData({ kind: 'squeeze' })).toEqual({ kind: 'squeeze' });
    expect(parsePushNotificationData({ kind: 'mystery' })).toBeNull();
    expect(parsePushNotificationData(null)).toBeNull();
    expect(pushNotificationDataSchema.safeParse({ kind: 'event_added' }).success).toBe(true);
  });
});

describe('location contract', () => {
  it('bounds coordinates and accuracy', () => {
    expect(locationShareRequestSchema.safeParse({
      mode: 'live',
      latitude: 91,
      longitude: 0,
    }).success).toBe(false);

    expect(locationShareRequestSchema.safeParse({
      mode: 'live',
      latitude: 37.7,
      longitude: -122.4,
      accuracyMeters: 5001,
    }).success).toBe(false);

    expect(locationShareRequestSchema.safeParse({
      mode: 'live',
      latitude: 37.7,
      longitude: -122.4,
    }).success).toBe(true);
  });
});

describe('media contract', () => {
  it('allow-lists MIME types', () => {
    expect(isAllowedMediaMimeType('image/jpeg')).toBe(true);
    expect(isAllowedMediaMimeType('audio/m4a')).toBe(true);
    expect(isAllowedMediaMimeType('application/pdf')).toBe(false);
  });

  it('caps upload size at 100MB', () => {
    expect(mediaUploadIntentRequestSchema.safeParse({
      filename: 'a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 100 * 1024 * 1024 + 1,
      kind: 'image',
    }).success).toBe(false);
  });

  it('builds stable serve URLs, never presigned ones', () => {
    expect(mediaObjectUrl('m1')).toBe('/v1/media/m1/object?variant=display');
    expect(mediaObjectUrl('m1', 'thumb')).toBe('/v1/media/m1/object?variant=thumb');
  });
});

describe('question contract', () => {
  it('parses the weekly response shape (reveal gate intact)', () => {
    const parsed = weeklyQuestionResponseSchema.parse({
      weekKey: '2026-W32',
      questionId: 3,
      question: 'q',
      yourAnswer: 'yes',
      yourAnswerUpdatedAt: '2026-01-01T00:00:00.000Z',
      partnerAnswered: false,
      partnerAnswer: null,
      partnerName: null,
      revealed: false,
    });
    expect(parsed.revealed).toBe(false);
  });
});

describe('shared pure helpers (behavior pins)', () => {
  it('sorts proposals newest-first', () => {
    const items = [
      { createdAt: '2026-01-01T00:00:00.000Z' },
      { createdAt: '2026-01-02T00:00:00.000Z' },
    ];
    expect(sortProposalsNewestFirst(items).map((i) => i.createdAt)).toEqual([
      '2026-01-02T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
  });

  it('sorts letters newest-first', () => {
    const items = [
      { createdAt: '2026-01-01T00:00:00.000Z' },
      { createdAt: '2026-01-02T00:00:00.000Z' },
    ];
    expect(sortLettersNewestFirst(items).map((i) => i.createdAt)).toEqual([
      '2026-01-02T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
  });

  it('sorts someday items open-first, then most-recently-checked', () => {
    const items = [
      { createdAt: '2026-01-01T00:00:00.000Z', checkedAt: null },
      { createdAt: '2026-01-02T00:00:00.000Z', checkedAt: null },
      { createdAt: '2026-01-01T00:00:00.000Z', checkedAt: '2026-01-05T00:00:00.000Z' },
    ];
    const sorted = sortSomedayItems(items);
    expect(sorted[0].checkedAt).toBeNull();
    expect(sorted[1].checkedAt).toBeNull();
    expect(sorted[2].checkedAt).not.toBeNull();
  });
});
