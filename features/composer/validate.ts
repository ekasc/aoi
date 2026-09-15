import { isAllowedMediaMimeType, MOMENT_ATTACHMENT_MAX } from '@aoi/shared';

import type { ComposerDraft, ComposerScope, PendingRecord, StagedAssetKind } from '@/features/composer/types';

export const COMPOSER_MANIFEST_VERSION = 1;
export const COMPOSER_BODY_MAX = 20000;

export function isValidScope(value: unknown): value is ComposerScope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.viewerId === 'string' && v.viewerId.length > 0 && typeof v.spaceId === 'string' && v.spaceId.length > 0;
}

export function scopeEquals(a: ComposerScope | null, b: ComposerScope | null): boolean {
  if (!a || !b) return false;
  return a.viewerId === b.viewerId && a.spaceId === b.spaceId;
}

export function scopeKey(scope: ComposerScope): string {
  return `${scope.viewerId}:${scope.spaceId}`;
}

function isValidKind(value: unknown): value is StagedAssetKind {
  return value === 'image' || value === 'audio';
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  return !Number.isNaN(Date.parse(value));
}

function isValidClientId(value: unknown): boolean {
  return typeof value === 'string' && value.length >= 1 && value.length <= 64;
}

export function isValidDraft(value: unknown): value is ComposerDraft {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!isValidClientId(v.clientId)) return false;
  if (typeof v.body !== 'string' || v.body.length > COMPOSER_BODY_MAX) return false;
  if (!isValidIsoDate(v.occurredAt)) return false;
  if (!Array.isArray(v.assets) || v.assets.length > MOMENT_ATTACHMENT_MAX) return false;
  for (const a of v.assets) {
    if (!a || typeof a !== 'object') return false;
    const asset = a as Record<string, unknown>;
    if (typeof asset.stagedId !== 'string' || asset.stagedId.length === 0) return false;
    if (!isValidKind(asset.kind)) return false;
    if (typeof asset.mimeType !== 'string' || !isAllowedMediaMimeType(asset.mimeType)) return false;
    if (typeof asset.localUri !== 'string' || asset.localUri.length === 0) return false;
    if (asset.uploaded !== undefined && asset.uploaded !== null) {
      const up = asset.uploaded as Record<string, unknown>;
      if (typeof up.mediaId !== 'string' || typeof up.url !== 'string') return false;
    }
  }
  return true;
}

export function isValidPending(value: unknown): value is PendingRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!isValidClientId(v.clientId)) return false;
  if (typeof v.body !== 'string' || v.body.length > COMPOSER_BODY_MAX) return false;
  if (!isValidIsoDate(v.occurredAt)) return false;
  if (v.status !== 'queued' && v.status !== 'sending' && v.status !== 'failed' && v.status !== 'delivered') return false;
  if (!isValidScope(v.scope)) return false;
  if (!Array.isArray(v.slots) || v.slots.length > MOMENT_ATTACHMENT_MAX) return false;
  for (const s of v.slots) {
    if (!s || typeof s !== 'object') return false;
    const slot = s as Record<string, unknown>;
    if (typeof slot.stagedId !== 'string' || slot.stagedId.length === 0) return false;
    if (!isValidKind(slot.kind)) return false;
    if (typeof slot.mimeType !== 'string' || !isAllowedMediaMimeType(slot.mimeType)) return false;
    if (typeof slot.localUri !== 'string' || slot.localUri.length === 0) return false;
    if (slot.uploaded !== null && slot.uploaded !== undefined) {
      const up = slot.uploaded as Record<string, unknown>;
      if (typeof up.mediaId !== 'string' || typeof up.url !== 'string') return false;
    }
  }
  if (typeof v.attempts !== 'number' || !Number.isInteger(v.attempts) || v.attempts < 0) return false;
  if (v.deliveredMoment !== undefined && v.deliveredMoment !== null) {
    const dm = v.deliveredMoment as Record<string, unknown>;
    if (typeof dm.id !== 'string' || dm.id.length === 0) return false;
    if (typeof dm.occurredAt !== 'string' || Number.isNaN(Date.parse(dm.occurredAt as string))) return false;
  }
  if (v.status === 'delivered') {
    const dm = v.deliveredMoment as Record<string, unknown> | null | undefined;
    if (!dm || typeof dm.id !== 'string' || dm.id.length === 0) return false;
  }
  return true;
}

export type ParsedManifest = {
  version: 1;
  scope: ComposerScope;
  draft: ComposerDraft | null;
  pending: PendingRecord[];
};

/**
 * JSON boundary validation for the decrypted manifest. Returns null on any
 * shape mismatch (corruption) — callers treat null as CORRUPT and fail
 * explicit, never as empty. No content is logged.
 */
export function parseManifestJson(raw: string): ParsedManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const v = parsed as Record<string, unknown>;
  if (v.version !== COMPOSER_MANIFEST_VERSION) return null;
  if (!isValidScope(v.scope)) return null;
  if (v.draft !== null && v.draft !== undefined && !isValidDraft(v.draft)) return null;
  if (!Array.isArray(v.pending)) return null;
  for (const p of v.pending) {
    if (!isValidPending(p)) return null;
  }
  return {
    version: 1,
    scope: v.scope as ComposerScope,
    draft: (v.draft as ComposerDraft | null) ?? null,
    pending: v.pending as PendingRecord[],
  };
}

export function serializeManifest(scope: ComposerScope, draft: ComposerDraft | null, pending: PendingRecord[]): string {
  return JSON.stringify({ version: COMPOSER_MANIFEST_VERSION, scope, draft, pending });
}
