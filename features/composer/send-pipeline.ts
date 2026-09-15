import type { CreateMomentInput, Moment } from '@/features/moments/types';
import type {
  ComposerScope,
  PendingRecord,
  UploadFn,
} from '@/features/composer/types';
import { assertSameScope, classifySendError } from '@/features/composer/composer-machine';

export type CreateFn = (input: CreateMomentInput) => Promise<Moment>;

export type SendDeps = {
  upload: UploadFn;
  create: CreateFn;
  getCurrentScope: () => ComposerScope | null;
};

export type SlotCheckpoint = {
  stagedId: string;
  uploaded: { mediaId: string; url: string };
};

/**
 * Narrow adapter: pending slots → create payload. Slots with a server media
 * id become ordered `{ mediaId, kind }` attachments; legacy
 * mediaPreview/audioUri/mediaId are derived from the first image/audio for
 * old clients. Slots without an id (stub mode) contribute legacy URLs only.
 */
export function buildCreateInput(record: PendingRecord): CreateMomentInput {
  const real = record.slots.filter((s) => s.uploaded?.mediaId);
  const attachments = real.map((s) => ({
    mediaId: (s.uploaded as { mediaId: string; url: string }).mediaId,
    kind: s.kind,
  }));
  const firstImage = real.find((s) => s.kind === 'image') ?? record.slots.find((s) => s.kind === 'image');
  const firstAudio = real.find((s) => s.kind === 'audio') ?? record.slots.find((s) => s.kind === 'audio');
  const firstAny = real[0] ?? record.slots[0];
  const imageUrl = firstImage?.uploaded?.url ?? (firstImage ? firstImage.localUri : null);
  const audioUrl = firstAudio?.uploaded?.url ?? (firstAudio ? firstAudio.localUri : null);
  const hasLocalOnly = record.slots.length > 0 && real.length === 0;
  // Stub mode: no server media ids, so the ordered contract cannot be met.
  // Carry every slot locally so a multi-photo memory still renders all of
  // them instead of silently collapsing to the first image.
  const localAttachments = hasLocalOnly
    ? record.slots.map((s) => ({ kind: s.kind, url: s.localUri }))
    : undefined;
  return {
    type: record.slots.length > 0 ? 'media' : 'note',
    title: '',
    body: record.body,
    occurredAt: record.occurredAt,
    targetAt: null,
    mediaPreview: hasLocalOnly ? (firstImage ? firstImage.localUri : null) : (imageUrl ?? null),
    audioUri: hasLocalOnly ? (firstAudio ? firstAudio.localUri : null) : (audioUrl ?? null),
    mediaId: hasLocalOnly ? null : (firstAny?.uploaded?.mediaId ?? null),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(localAttachments ? { localAttachments } : {}),
    clientId: record.clientId,
  };
}

/**
 * Send one immutable pending record with per-step scope guards.
 *
 * - Reuses uploaded checkpoints (never re-uploads a successful slot).
 * - Validates the CURRENT scope before EVERY network step (each upload +
 *   create); on drift it throws SCOPE_CHANGED with zero further network use
 *   (prevents account A requests on B credentials from the shared client).
 * - `onSlotUploaded` persists the checkpoint immediately so a mid-upload
 *   crash/retry resumes without re-uploading.
 * - Resolves the server moment ONLY after the API returns; never claims
 *   delivered earlier. Rejects with the coded error (LIMIT_EXCEEDED etc).
 */
export async function sendPendingRecord(
  record: PendingRecord,
  deps: SendDeps,
  onSlotUploaded?: (checkpoint: SlotCheckpoint) => Promise<void>
): Promise<Moment> {
  assertSameScope(record.scope, deps.getCurrentScope());

  const slots = record.slots.map((s) => ({ ...s }));
  for (const slot of slots) {
    if (slot.uploaded?.mediaId) continue;
    // Scope re-check before EACH upload (immutable sender guard).
    assertSameScope(record.scope, deps.getCurrentScope());
    const result = await deps.upload({ uri: slot.localUri, mimeType: slot.mimeType }, undefined, () =>
      assertSameScope(record.scope, deps.getCurrentScope())
    );
    if (result.mediaId) {
      slot.uploaded = { mediaId: result.mediaId, url: result.url };
      if (onSlotUploaded) {
        await onSlotUploaded({ stagedId: slot.stagedId, uploaded: slot.uploaded });
      }
    } else {
      // Stub mode: no server id — leave uploaded null; the create payload
      // falls back to local legacy URLs (see buildCreateInput).
      slot.uploaded = null;
    }
  }

  // Scope re-check before create (immutable sender guard).
  assertSameScope(record.scope, deps.getCurrentScope());

  const input = buildCreateInput({ ...record, slots });
  try {
    return await deps.create(input);
  } catch (err) {
    void classifySendError(err);
    throw err;
  }
}
