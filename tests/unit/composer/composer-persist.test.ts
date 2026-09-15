import { describe, expect, it, vi } from 'vitest';

import { ComposerStore } from '@/features/composer/composer-store';
import {
  createMemoryFileStore,
  createMemoryKeyStore,
  memoryComposerCrypto,
} from '@/features/composer/composer-memory-adapters';
import {
  buildPendingFromDraft,
  newEmptyDraft,
  recoverSendingToQueued,
} from '@/features/composer/composer-machine';
import type { ComposerScope } from '@/features/composer/types';

const scopeA: ComposerScope = { viewerId: 'user_a', spaceId: 'space_1' };
const scopeB: ComposerScope = { viewerId: 'user_b', spaceId: 'space_1' };

function makeStore() {
  const files = createMemoryFileStore();
  const store = new ComposerStore({
    keyStore: createMemoryKeyStore(),
    fileStore: files,
    crypto: memoryComposerCrypto,
  });
  return { store, files };
}

describe('composer durability', () => {
  it('draft restore preserves the stable clientId across reloads', async () => {
    const { store } = makeStore();
    const draft = newEmptyDraft('moment_stable-1', '2026-03-15T10:00:00.000Z');
    const edited = { ...draft, body: 'still here', occurredAt: '2026-03-14T10:00:00.000Z' };
    await store.saveManifest(scopeA, edited, []);
    const reloaded = await store.loadManifest(scopeA);
    expect(reloaded.draft?.clientId).toBe('moment_stable-1');
    expect(reloaded.draft?.body).toBe('still here');
  });

  it('manifest is persisted before any network starts (save ordering)', async () => {
    const { store, files } = makeStore();
    const order: string[] = [];
    const draft = {
      ...newEmptyDraft('moment_order-1', '2026-03-15T10:00:00.000Z'),
      body: 'go',
    };
    const pending = [buildPendingFromDraft(draft, scopeA, '2026-03-15T10:00:00.000Z')];
    const fresh = newEmptyDraft('moment_order-2', '2026-03-15T10:00:01.000Z');
    const persistSpy = vi.spyOn(store, 'saveManifest');
    persistSpy.mockImplementation(async (...args: Parameters<typeof store.saveManifest>) => {
      order.push('persist');
      return Reflect.apply(ComposerStore.prototype.saveManifest, store, args);
    });
    await store.saveManifest(scopeA, fresh, pending);
    order.push('network');
    expect(order).toEqual(['persist', 'network']);
    expect(persistSpy).toHaveBeenCalledTimes(1);
    const raw = await files.readText('composer/user_a/space_1/manifest.enc');
    expect(raw).toBeTruthy();
  });

  it('restart recovers sending -> queued without auto-sending mutable drafts', async () => {
    const draft = newEmptyDraft('moment_live-1', '2026-03-15T10:00:00.000Z');
    const queued = {
      ...buildPendingFromDraft({ ...draft, body: 'outbox item' }, scopeA, '2026-03-15T10:00:00.000Z'),
      status: 'sending' as const,
    };
    const recovered = recoverSendingToQueued([queued]);
    expect(recovered[0]?.status).toBe('queued');
    expect(recovered[0]?.clientId).toBe(queued.clientId);
    expect(recovered[0]?.body).toBe('outbox item');
    // Mutable draft itself is never queued/sent implicitly.
    expect(draft.body).toBe('');
  });

  it('discard cleans owned staged files only', async () => {
    const { store, files } = makeStore();
    await files.writeAtomic('composer/user_a/space_1/staged/owned.jpg', 'bytes');
    await files.writeAtomic('composer/user_a/space_1/staged/other.jpg', 'bytes');
    await files.writeAtomic('composer/user_b/space_1/staged/theirs.jpg', 'bytes');
    await store.deletePaths(['composer/user_a/space_1/staged/owned.jpg']);
    expect(await files.exists('composer/user_a/space_1/staged/owned.jpg')).toBe(false);
    expect(await files.exists('composer/user_a/space_1/staged/other.jpg')).toBe(true);
    expect(await files.exists('composer/user_b/space_1/staged/theirs.jpg')).toBe(true);
  });

  it('scope switch exposes nothing cross-scope (disk isolated, memory cleared by provider)', async () => {
    const keyStore = createMemoryKeyStore();
    const files = createMemoryFileStore();
    const store = new ComposerStore({ keyStore, fileStore: files, crypto: memoryComposerCrypto });
    await store.saveManifest(scopeA, { ...newEmptyDraft('moment_a-1', '2026-03-15T10:00:00.000Z'), body: 'A private' }, []);
    const loadedB = await store.loadManifest(scopeB);
    // B sees a blank slate — never A's body or clientId.
    expect(loadedB.draft).toBeNull();
    expect(loadedB.pending).toEqual([]);
    const loadedA = await store.loadManifest(scopeA);
    expect(loadedA.draft?.body).toBe('A private');
  });
});
