import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  CreateMomentResponseInput,
  MomentResponse,
  MomentResponseRepository,
} from '@/features/responses/types';

const KEY_PREFIX = 'aoi.responses.v1.';

function key(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/**
 * Validation on the way out of storage, not just in. AsyncStorage is
 * effectively untrusted input: it survives app updates, it is shared across
 * the debug harness, and a half-written record from an older shape would
 * otherwise render as a response with a `kind` that does not match its
 * fields. Dropping a malformed row is recoverable; rendering a broken one
 * in the middle of the exchange is not.
 */
function isUsableResponse(value: unknown): value is MomentResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.momentId !== 'string') {
    return false;
  }
  if (typeof row.authorRole !== 'string') {
    return false;
  }
  if (typeof row.createdAt !== 'string') {
    return false;
  }
  switch (row.kind) {
    case 'tap':
      return true;
    case 'word':
      return typeof row.body === 'string' && row.body.trim().length > 0;
    case 'photo':
      return typeof row.mediaPreview === 'string' && row.mediaPreview.length > 0;
    case 'voice':
      return typeof row.audioUri === 'string' && row.audioUri.length > 0;
    default:
      return false;
  }
}

async function readAll(userId: string): Promise<MomentResponse[]> {
  const raw = await AsyncStorage.getItem(key(userId));
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isUsableResponse);
  } catch {
    return [];
  }
}

async function writeAll(userId: string, rows: MomentResponse[]): Promise<void> {
  await AsyncStorage.setItem(key(userId), JSON.stringify(rows));
}

/** Newest first, so the exchange reads as a conversation rather than a log. */
function byNewest(a: MomentResponse, b: MomentResponse): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

export function createLocalMomentResponseRepository(
  userId: string,
): MomentResponseRepository {
  return {
    async listForMoment(momentId) {
      const all = await readAll(userId);
      return all.filter((row) => row.momentId === momentId).sort(byNewest);
    },

    async add(input: CreateMomentResponseInput): Promise<MomentResponse> {
      const all = await readAll(userId);
      const response: MomentResponse = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        momentId: input.momentId,
        authorId: input.authorId,
        authorRole: input.authorRole,
        authorName: input.authorName,
        kind: input.kind,
        body: input.kind === 'word' ? input.body ?? null : null,
        mediaPreview: input.kind === 'photo' ? input.mediaPreview ?? null : null,
        audioUri: input.kind === 'voice' ? input.audioUri ?? null : null,
        createdAt: new Date().toISOString(),
      };
      // Fields not belonging to the kind are cleared on write, so a caller
      // that sends a stray `body` on a photo cannot smuggle it through.
      await writeAll(userId, [response, ...all]);
      return response;
    },
  };
}
