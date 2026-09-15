import type { ComposerDraft, ComposerScope, PendingRecord } from '@/features/composer/types';
import {
  parseManifestJson,
  serializeManifest,
} from '@/features/composer/validate';

export type ComposerKeyStore = {
  getKey: (viewerId: string) => Promise<string | null>;
  setKey: (viewerId: string, keyBase64: string) => Promise<void>;
};

export type ComposerFileStore = {
  readText: (path: string) => Promise<string | null>;
  writeAtomic: (path: string, contents: string) => Promise<void>;
  delete: (path: string) => Promise<void>;
  copy: (from: string, to: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
};

export type ComposerCrypto = {
  generateKeyBase64: () => Promise<string>;
  encryptToBase64: (plaintext: Uint8Array, keyBase64: string) => Promise<string>;
  decryptFromBase64: (combinedBase64: string, keyBase64: string) => Promise<Uint8Array>;
};

export type ComposerStoreDeps = {
  keyStore: ComposerKeyStore;
  fileStore: ComposerFileStore;
  crypto: ComposerCrypto;
};

export type LoadedManifest = {
  draft: ComposerDraft | null;
  pending: PendingRecord[];
};

export function manifestPathFor(scope: ComposerScope): string {
  return `composer/${encodeURIComponent(scope.viewerId)}/${encodeURIComponent(scope.spaceId)}/manifest.enc`;
}

export function stagedDirFor(scope: ComposerScope): string {
  return `composer/${encodeURIComponent(scope.viewerId)}/${encodeURIComponent(scope.spaceId)}/staged`;
}

export function stagedPathFor(scope: ComposerScope, stagedId: string, ext: string): string {
  const safeId = stagedId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'asset';
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';
  return `${stagedDirFor(scope)}/${safeId}.${safeExt}`;
}

export function extForMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/avif') return 'avif';
  if (mimeType === 'image/heic') return 'heic';
  if (mimeType === 'image/heif') return 'heif';
  if (mimeType === 'audio/m4a' || mimeType === 'audio/x-m4a' || mimeType === 'audio/mp4') return 'm4a';
  if (mimeType === 'audio/aac') return 'aac';
  if (mimeType === 'audio/wav') return 'wav';
  return 'bin';
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export class ComposerStoreError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Single owner/writer for durable composer state. All reads/writes funnel
 * through one promise chain so concurrent edits can never drop a draft.
 * Ciphertext only on disk; the key lives in the keystore (never the file).
 * No URIs/keys/content are logged.
 */
export class ComposerStore {
  private deps: ComposerStoreDeps;
  private tail: Promise<void> = Promise.resolve();

  constructor(deps: ComposerStoreDeps) {
    this.deps = deps;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async ensureKey(viewerId: string): Promise<string> {
    let key: string | null = null;
    try {
      key = await this.deps.keyStore.getKey(viewerId);
    } catch {
      throw new ComposerStoreError('STORE_UNAVAILABLE', 'Could not open saved drafts. Please try again.');
    }
    if (key) return key;
    let fresh: string;
    try {
      fresh = await this.deps.crypto.generateKeyBase64();
    } catch {
      // No insecure fallback: fail explicit when key creation fails.
      throw new ComposerStoreError('KEY_UNAVAILABLE', 'Could not unlock saved drafts. Please try again.');
    }
    try {
      await this.deps.keyStore.setKey(viewerId, fresh);
    } catch {
      throw new ComposerStoreError('KEY_UNAVAILABLE', 'Could not unlock saved drafts. Please try again.');
    }
    return fresh;
  }

  loadManifest(scope: ComposerScope): Promise<LoadedManifest> {
    return this.enqueue(async () => {
      const path = manifestPathFor(scope);
      let raw: string | null = null;
      try {
        raw = await this.deps.fileStore.readText(path);
      } catch {
        throw new ComposerStoreError('STORE_UNAVAILABLE', 'Could not open saved drafts. Please try again.');
      }
      if (!raw) return { draft: null, pending: [] };
      let key: string | null = null;
      try {
        key = await this.deps.keyStore.getKey(scope.viewerId);
      } catch {
        throw new ComposerStoreError('STORE_UNAVAILABLE', 'Could not open saved drafts. Please try again.');
      }
      if (!key) {
        // Key lost (e.g. keystore cleared) with ciphertext on disk: fail
        // explicit rather than silently orphaning user drafts.
        throw new ComposerStoreError('KEY_UNAVAILABLE', 'Could not unlock saved drafts. Please try again.');
      }
      let bytes: Uint8Array;
      try {
        bytes = await this.deps.crypto.decryptFromBase64(raw, key);
      } catch {
        throw new ComposerStoreError('CORRUPT', 'Saved drafts look damaged. Discard the draft to start fresh.');
      }
      const parsed = parseManifestJson(decodeUtf8(bytes));
      if (!parsed) {
        throw new ComposerStoreError('CORRUPT', 'Saved drafts look damaged. Discard the draft to start fresh.');
      }
      // Cross-scope file misuse guard: the decrypted scope must match.
      if (parsed.scope.viewerId !== scope.viewerId || parsed.scope.spaceId !== scope.spaceId) {
        throw new ComposerStoreError('CORRUPT', 'Saved drafts look damaged. Discard the draft to start fresh.');
      }
      return { draft: parsed.draft, pending: parsed.pending };
    });
  }

  saveManifest(scope: ComposerScope, draft: ComposerDraft | null, pending: PendingRecord[]): Promise<void> {
    return this.enqueue(async () => {
      // Fail closed on key loss: ciphertext on disk with no key must never
      // be orphaned by a fresh-key overwrite. Leave bytes; explicit reset
      // (deleteScopeFiles) is the only recovery path. Typed KEY_UNAVAILABLE.
      let existingKey: string | null = null;
      try {
        existingKey = await this.deps.keyStore.getKey(scope.viewerId);
      } catch {
        throw new ComposerStoreError('STORE_UNAVAILABLE', 'Could not open saved drafts. Please try again.');
      }
      if (!existingKey) {
        let raw: string | null = null;
        try {
          raw = await this.deps.fileStore.readText(manifestPathFor(scope));
        } catch {
          throw new ComposerStoreError('STORE_UNAVAILABLE', 'Could not open saved drafts. Please try again.');
        }
        if (raw) {
          throw new ComposerStoreError('KEY_UNAVAILABLE', 'Could not unlock saved drafts. Please try again.');
        }
      }
      const key = await this.ensureKey(scope.viewerId);
      const json = serializeManifest(scope, draft, pending);
      let combined: string;
      try {
        combined = await this.deps.crypto.encryptToBase64(encodeUtf8(json), key);
      } catch {
        throw new ComposerStoreError('STORE_UNAVAILABLE', 'Could not open saved drafts. Please try again.');
      }
      try {
        await this.deps.fileStore.writeAtomic(manifestPathFor(scope), combined);
      } catch {
        throw new ComposerStoreError('STORE_UNAVAILABLE', 'Could not open saved drafts. Please try again.');
      }
    });
  }

  /** Delete manifest + staged files without needing the key (explicit discard). */
  async deleteScopeFiles(scope: ComposerScope, ownedUris: string[]): Promise<void> {
    await this.enqueue(async () => {
      const dir = stagedDirFor(scope);
      for (const uri of ownedUris) {
        if (!uri.startsWith(dir)) continue;
        try {
          await this.deps.fileStore.delete(uri);
        } catch {
          // Best-effort per-file cleanup; manifest delete still runs.
        }
      }
      try {
        await this.deps.fileStore.delete(manifestPathFor(scope));
      } catch {
        // Best-effort.
      }
    });
  }

  async deletePaths(paths: string[]): Promise<void> {
    await this.enqueue(async () => {
      for (const p of paths) {
        try {
          await this.deps.fileStore.delete(p);
        } catch {
          // Best-effort.
        }
      }
    });
  }

  get fileStore(): ComposerFileStore {
    return this.deps.fileStore;
  }
}
