import { describe, expect, it } from 'vitest';

import { ComposerStore } from '@/features/composer/composer-store';
import {
  createMemoryFileStore,
  createMemoryKeyStore,
  memoryComposerCrypto,
} from '@/features/composer/composer-memory-adapters';
import type { ComposerScope } from '@/features/composer/types';

const scope: ComposerScope = { viewerId: 'user_a', spaceId: 'space_1' };

function makeStore() {
  return new ComposerStore({
    keyStore: createMemoryKeyStore(),
    fileStore: createMemoryFileStore(),
    crypto: memoryComposerCrypto,
  });
}

describe('composer encrypted storage', () => {
  it('roundtrips body + staged URIs through AES-GCM ciphertext', async () => {
    const store = makeStore();
    const draft = {
      clientId: 'moment_test-1',
      body: 'a quiet note',
      occurredAt: '2026-03-15T10:00:00.000Z',
      assets: [
        {
          stagedId: 'staged_1',
          kind: 'image' as const,
          mimeType: 'image/jpeg',
          localUri: 'composer/user_a/space_1/staged/staged_1.jpg',
          uploaded: null,
        },
      ],
      updatedAt: '2026-03-15T10:00:00.000Z',
    };
    await store.saveManifest(scope, draft, []);
    const loaded = await store.loadManifest(scope);
    expect(loaded.draft?.clientId).toBe('moment_test-1');
    expect(loaded.draft?.body).toBe('a quiet note');
    expect(loaded.draft?.assets[0]?.localUri).toBe('composer/user_a/space_1/staged/staged_1.jpg');
  });

  it('ciphertext on disk is not plaintext (no body / URI readable)', async () => {
    const files = createMemoryFileStore();
    const store = new ComposerStore({
      keyStore: createMemoryKeyStore(),
      fileStore: files,
      crypto: memoryComposerCrypto,
    });
    await store.saveManifest(scope, {
      clientId: 'moment_test-2',
      body: 'secret-words-xyz',
      occurredAt: '2026-03-15T10:00:00.000Z',
      assets: [],
      updatedAt: '2026-03-15T10:00:00.000Z',
    }, []);
    const raw = await files.readText('composer/user_a/space_1/manifest.enc');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('secret-words-xyz');
    expect(raw).not.toContain('moment_test-2');
  });

  it('wrong key fails explicit (no silent decrypt)', async () => {
    const files = createMemoryFileStore();
    const keysA = createMemoryKeyStore();
    const writer = new ComposerStore({ keyStore: keysA, fileStore: files, crypto: memoryComposerCrypto });
    await writer.saveManifest(scope, {
      clientId: 'moment_test-3',
      body: 'locked',
      occurredAt: '2026-03-15T10:00:00.000Z',
      assets: [],
      updatedAt: '2026-03-15T10:00:00.000Z',
    }, []);
    const keysB = createMemoryKeyStore();
    const reader = new ComposerStore({ keyStore: keysB, fileStore: files, crypto: memoryComposerCrypto });
    await expect(reader.loadManifest(scope)).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
  });

  it('corrupted ciphertext fails explicit with CORRUPT', async () => {
    const files = createMemoryFileStore();
    const store = new ComposerStore({
      keyStore: createMemoryKeyStore(),
      fileStore: files,
      crypto: memoryComposerCrypto,
    });
    await store.saveManifest(scope, {
      clientId: 'moment_test-4',
      body: 'hello',
      occurredAt: '2026-03-15T10:00:00.000Z',
      assets: [],
      updatedAt: '2026-03-15T10:00:00.000Z',
    }, []);
    const raw = (await files.readText('composer/user_a/space_1/manifest.enc')) as string;
    const tampered = raw.slice(0, -4) + 'AAAA';
    await files.writeAtomic('composer/user_a/space_1/manifest.enc', tampered);
    await expect(store.loadManifest(scope)).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('secure key creation failure fails explicit (no insecure fallback)', async () => {
    const files = createMemoryFileStore();
    const badKeys = {
      async getKey() {
        return null;
      },
      async setKey() {
        throw new Error('keystore denied');
      },
    };
    const store = new ComposerStore({ keyStore: badKeys, fileStore: files, crypto: memoryComposerCrypto });
    await expect(
      store.saveManifest(scope, {
        clientId: 'moment_test-5',
        body: 'hello',
        occurredAt: '2026-03-15T10:00:00.000Z',
        assets: [],
        updatedAt: '2026-03-15T10:00:00.000Z',
      }, [])
    ).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
    expect(await files.readText('composer/user_a/space_1/manifest.enc')).toBeNull();
  });
});
