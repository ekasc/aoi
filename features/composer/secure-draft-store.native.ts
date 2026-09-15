import * as SecureStore from 'expo-secure-store';
import {
  AESEncryptionKey,
  AESKeySize,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from 'expo-crypto';
import {
  copyAsync,
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  moveAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';

import type {
  ComposerCrypto,
  ComposerFileStore,
  ComposerKeyStore,
} from '@/features/composer/composer-store';
import { ComposerStore } from '@/features/composer/composer-store';

/**
 * Native durability backend.
 *
 * Manifest: AES-256-GCM (expo-crypto) ciphertext file in Documents,
 * atomic tmp-write + move. Key: 256-bit random, base64 in SecureStore per
 * viewer (`aoi.composer.key.<viewerId>`, key material only — never JSON).
 * Key creation failure throws explicit (no insecure plaintext fallback).
 * Decrypted JSON is schema-validated at the boundary; corruption throws
 * CORRUPT. No URIs/keys/content are logged.
 *
 * Staged media honesty: staged photos/voice are verbatim copies under
 * Documents/composer/<viewer>/<space>/staged/ (app-private sandbox). They
 * are NOT app-layer AES-encrypted: expo-crypto AES is one-shot in-memory
 * with no streaming, so encrypting up to the 100MB media budget would risk
 * OOM on low-memory devices. At-rest protection is the OS sandbox +
 * device encryption (iOS Data Protection / Android file-based encryption);
 * the manifest — which holds the body AND the Documents URIs — IS
 * AES-GCM encrypted, cache URIs are never persisted (we copy to Documents
 * on ingest), and nothing touches AsyncStorage. Ephemeral cache
 * decryptions are unnecessary because bytes are already private; preview /
 * upload read the Documents copy and staged files are deleted on
 * discard/deliver (owned files only).
 */

function keyName(viewerId: string): string {
  return `aoi.composer.key.${viewerId}`;
}

function requireDocuments(): string {
  if (!documentDirectory) {
    throw new Error('Document directory unavailable');
  }
  return documentDirectory;
}

export const composerKeyStore: ComposerKeyStore = {
  async getKey(viewerId) {
    return SecureStore.getItemAsync(keyName(viewerId));
  },
  async setKey(viewerId, keyBase64) {
    await SecureStore.setItemAsync(keyName(viewerId), keyBase64);
  },
};

export const composerFileStore: ComposerFileStore = {
  async readText(path) {
    const base = requireDocuments();
    const info = await getInfoAsync(base + path);
    if (!info.exists || info.isDirectory) return null;
    return readAsStringAsync(base + path);
  },
  async writeAtomic(path, contents) {
    const base = requireDocuments();
    const tmp = `${path}.tmp`;
    const dir = base + path.split('/').slice(0, -1).join('/');
    await makeDirectoryAsync(dir, { intermediates: true });
    await writeAsStringAsync(base + tmp, contents);
    await moveAsync({ from: base + tmp, to: base + path });
  },
  async delete(path) {
    const base = requireDocuments();
    const info = await getInfoAsync(base + path);
    if (!info.exists) return;
    await deleteAsync(base + path, { idempotent: true });
  },
  async copy(from, to) {
    const base = requireDocuments();
    const dir = base + to.split('/').slice(0, -1).join('/');
    await makeDirectoryAsync(dir, { intermediates: true });
    // `from` may be a cache/picker URI (any scheme FileSystem accepts);
    // `to` is always a Documents path under our staged dir.
    const source = from.startsWith('file://') || from.startsWith('content://') ? from : base + from;
    await copyAsync({ from: source, to: base + to });
  },
  async exists(path) {
    const base = requireDocuments();
    const info = await getInfoAsync(base + path);
    return info.exists;
  },
};

export const composerCrypto: ComposerCrypto = {
  async generateKeyBase64() {
    const key = await AESEncryptionKey.generate(AESKeySize.AES256);
    return key.encoded('base64');
  },
  async encryptToBase64(plaintext, keyBase64) {
    const key = await AESEncryptionKey.import(keyBase64, 'base64');
    const sealed = await aesEncryptAsync(plaintext, key);
    const combined = await sealed.combined('base64');
    if (typeof combined !== 'string') {
      throw new Error('Encrypt failed');
    }
    return combined;
  },
  async decryptFromBase64(combinedBase64, keyBase64) {
    const key = await AESEncryptionKey.import(keyBase64, 'base64');
    const sealed = AESSealedData.fromCombined(combinedBase64);
    const result = await aesDecryptAsync(sealed, key);
    if (typeof result === 'string') {
      throw new Error('Unexpected decrypt encoding');
    }
    return result as Uint8Array;
  },
};

export function createDefaultComposerStore(): ComposerStore {
  return new ComposerStore({
    keyStore: composerKeyStore,
    fileStore: composerFileStore,
    crypto: composerCrypto,
  });
}
