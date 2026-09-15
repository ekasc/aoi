import type {
  ComposerCrypto,
  ComposerFileStore,
  ComposerKeyStore,
} from '@/features/composer/composer-store';
import { ComposerStore } from '@/features/composer/composer-store';

/**
 * Test-safe + web fallback adapters: memory key/file stores + real AES-GCM
 * via WebCrypto (SubtleCrypto). No native modules are imported here, so pure
 * unit tests can exercise the exact store encode/encrypt/persist/parse path
 * without loading expo-crypto / SecureStore / FileSystem.
 *
 * Web honesty: this keeps drafts only for the JS session (the Map clears on
 * reload). It makes NO persistent-security claim — see
 * `secure-draft-store.web.ts`.
 */

type NodeBuffer = {
  from: (data: Uint8Array | string, encoding?: string) => { toString: (encoding: string) => string } & Uint8Array;
};

function nodeBuffer(): NodeBuffer | null {
  const g = globalThis as { Buffer?: NodeBuffer };
  return g.Buffer ?? null;
}

function toBase64(bytes: Uint8Array): string {
  const buf = nodeBuffer();
  if (buf) {
    return buf.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const buf = nodeBuffer();
  if (buf) {
    return new Uint8Array(buf.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function subtle(): SubtleCrypto {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoObj?.subtle) {
    throw new Error('WebCrypto unavailable');
  }
  return cryptoObj.subtle;
}

export const memoryComposerCrypto: ComposerCrypto = {
  async generateKeyBase64() {
    const bytes = new Uint8Array(32);
    (globalThis as { crypto?: Crypto }).crypto?.getRandomValues?.(bytes);
    if (!bytes.some((b) => b !== 0)) {
      // Fallback entropy only when WebCrypto RNG is absent (tests stub it).
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return toBase64(bytes);
  },
  async encryptToBase64(plaintext, keyBase64) {
    const keyBytes = fromBase64(keyBase64);
    const iv = new Uint8Array(12);
    (globalThis as { crypto?: Crypto }).crypto?.getRandomValues?.(iv);
    const key = await subtle().importKey('raw', keyBytes.slice().buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt']);
    const encrypted = await subtle().encrypt({ name: 'AES-GCM', iv: iv.slice().buffer as ArrayBuffer }, key, plaintext.slice().buffer as ArrayBuffer);
    const cipher = new Uint8Array(encrypted);
    const combined = new Uint8Array(12 + cipher.length);
    combined.set(iv, 0);
    combined.set(cipher, 12);
    return toBase64(combined);
  },
  async decryptFromBase64(combinedBase64, keyBase64) {
    const keyBytes = fromBase64(keyBase64);
    const combined = fromBase64(combinedBase64);
    if (combined.length < 12 + 16) throw new Error('Too short');
    const iv = combined.slice(0, 12);
    const cipher = combined.slice(12);
    const key = await subtle().importKey('raw', keyBytes.slice().buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: iv.slice().buffer as ArrayBuffer }, key, cipher.slice().buffer as ArrayBuffer);
    return new Uint8Array(plain);
  },
};

export function createMemoryKeyStore(): ComposerKeyStore & { clear: () => void } {
  const map = new Map<string, string>();
  return {
    async getKey(viewerId) {
      return map.get(viewerId) ?? null;
    },
    async setKey(viewerId, keyBase64) {
      map.set(viewerId, keyBase64);
    },
    clear() {
      map.clear();
    },
  };
}

export function createMemoryFileStore(): ComposerFileStore & { clear: () => void; keys: () => string[] } {
  const map = new Map<string, string>();
  return {
    async readText(path) {
      return map.get(path) ?? null;
    },
    async writeAtomic(path, contents) {
      map.set(path, contents);
    },
    async delete(path) {
      map.delete(path);
    },
    async copy(from, to) {
      const value = map.get(from);
      if (value === undefined) {
        // In tests the picker source may not exist in the map — stage an
        // opaque placeholder so durability semantics still hold.
        map.set(to, `staged-copy-of:${from}`);
        return;
      }
      map.set(to, value);
    },
    async exists(path) {
      return map.has(path);
    },
    clear() {
      map.clear();
    },
    keys() {
      return [...map.keys()];
    },
  };
}

export const composerKeyStore = createMemoryKeyStore();
export const composerFileStore = createMemoryFileStore();
export const composerCrypto = memoryComposerCrypto;

export function createDefaultComposerStore(): ComposerStore {
  return new ComposerStore({
    keyStore: composerKeyStore,
    fileStore: composerFileStore,
    crypto: composerCrypto,
  });
}
