import { apiFetch, isStubMode } from '@/features/api-client';
import { resolveStagedUri } from '@/features/composer/staged-uri';
import { mediaObjectUrl } from '@aoi/shared';

export type MediaUploadInput = {
  uri: string;
  mimeType: string;
};

export type UploadInput = MediaUploadInput;

export type MediaUploadResult = {
  mediaId: string | null;
  url: string;
};

/**
 * Machine-readable upload failure identity for Plus-limit interception.
 * Thrown (not returned) so callers can distinguish quota blocks from
 * generic failures synchronously.
 */
export function uploadErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

export function isQuotaExceededError(error: unknown): boolean {
  return uploadErrorCode(error) === 'LIMIT_EXCEEDED';
}

/**
 * Direct-to-R2 upload with server authorization (non-hook service):
 *   1. POST /v1/media/upload-url → { mediaId, uploadUrl, expiresInSec, headers }
 *   2. PUT the bytes straight to the presigned URL (device → R2, no proxy)
 *   3. POST /v1/media/:id/complete → head-verify + enqueue server sanitize
 *
 * Resolves the upload result, or THROWS the underlying (possibly coded)
 * error — including LIMIT_EXCEEDED when the Space quota blocks the intent.
 *
 * `onProgress` is the pre-existing progress signal only (0..1 fractions);
 * callers may omit it. No other speculative callbacks.
 *
 * `assertScope` is an optional scope guard (default no-op, preserving the
 * existing hook API). The send pipeline passes a callback that throws
 * SCOPE_CHANGED when the account/space drifted. It is invoked before EVERY
 * network step (intent, PUT, complete) and after every await so an intent
 * → complete account switch aborts with zero further authenticated use.
 * Bearer tokens are never persisted here — auth rides on apiFetch memory
 * only; presigned URLs are per-request and never stored.
 *
 * The stable app URL is the only thing ever persisted (`display` for
 * images, `original` for audio). Presigned URLs are per-request and never
 * stored. Stub mode has no server media id (`mediaId` null, `url` local).
 */
export async function uploadMediaAsset(
  input: MediaUploadInput,
  onProgress?: (fraction: number) => void,
  assertScope?: () => void
): Promise<MediaUploadResult> {
  const check = assertScope ?? (() => {});
  check();
  if (isStubMode()) {
    return { mediaId: null, url: input.uri };
  }

  const filename = input.uri.split('/').pop() ?? `photo_${Date.now()}.jpg`;
  const mimeType = input.mimeType;
  const kind = mimeType.startsWith('audio/') ? 'audio' : 'image';

  onProgress?.(0.1);

  // Staged composer assets are Documents-relative paths; picker and
  // remote URIs pass through untouched.
  const response = await fetch(resolveStagedUri(input.uri));
  const blob = await response.blob();
  const sizeBytes = blob.size;

  onProgress?.(0.2);
  check();

  // 1. Server-authorized intent → presigned PUT (never persisted).
  const intent = await apiFetch<{
    mediaId: string;
    uploadUrl: string;
    expiresInSec: number;
    headers?: Record<string, string>;
  }>('/v1/media/upload-url', {
    method: 'POST',
    body: JSON.stringify({ filename, mimeType, sizeBytes, kind }),
  });

  onProgress?.(0.3);
  check();

  // 2. Direct device → R2 upload.
  const uploadResult = await fetch(intent.uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: intent.headers ?? { 'Content-Type': mimeType },
  });

  if (!uploadResult.ok) {
    throw new Error('Upload to storage failed');
  }

  onProgress?.(0.7);
  check();

  // 3. Confirm: server head-verifies and enqueues sanitization.
  await apiFetch(`/v1/media/${intent.mediaId}/complete`, { method: 'POST' });

  const stableUrl = mediaObjectUrl(intent.mediaId, kind === 'audio' ? 'original' : 'display');
  onProgress?.(1);
  return { mediaId: intent.mediaId, url: stableUrl };
}
