import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

import { ComposerProvider, useComposer } from '@/features/composer/composer-context';
import { ComposerStore } from '@/features/composer/composer-store';
import {
  createMemoryFileStore,
  createMemoryKeyStore,
  memoryComposerCrypto,
} from '@/features/composer/composer-memory-adapters';
import type { ComposerScope } from '@/features/composer/types';

const sessionState = vi.hoisted(() => ({
  userId: 'user_a',
}));

const addMomentMock = vi.hoisted(() => vi.fn(async (input: unknown) => ({ id: 'moment_1', ...(input as object) })) );

vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({
    user:
      sessionState.userId === null
        ? null
        : { id: sessionState.userId, email: 'a@test.local', displayName: 'A' },
  }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { id: 'space_1' } }),
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({ addMoment: addMomentMock }),
}));

function makeStores() {
  const keyStore = createMemoryKeyStore();
  const fileStore = createMemoryFileStore();
  const store = new ComposerStore({ keyStore, fileStore, crypto: memoryComposerCrypto });
  return { keyStore, fileStore, store };
}

function Probe({ onApi }: { onApi: (api: ReturnType<typeof useComposer>) => void }) {
  const api = useComposer();
  onApi(api);
  return null;
}

async function renderProvider(stores: ReturnType<typeof makeStores>, upload?: unknown, create?: unknown) {
  let api: ReturnType<typeof useComposer> | null = null;
  const deps: Record<string, unknown> = { store: stores.store, now: () => '2026-03-15T10:00:00.000Z' };
  if (upload) deps.upload = upload;
  if (create) deps.create = create;
  const view = render(
    <ComposerProvider deps={deps as never}>
      <Probe onApi={(a) => { api = a; }} />
    </ComposerProvider>
  );
  await waitFor(() => expect(api?.draft).not.toBeNull(), { timeout: 2000 });
  const getApi = () => api as NonNullable<typeof api>;
  return { view, getApi };
}

beforeEach(() => {
  sessionState.userId = 'user_a';
  addMomentMock.mockClear();
  addMomentMock.mockImplementation(async (input: unknown) => ({ id: 'moment_1', ...(input as object) }));
});

describe('composer provider durability', () => {
  it('concurrent body updates serialize: memory and disk agree (no lost persist)', async () => {
    const stores = makeStores();
    const { view, getApi } = await renderProvider(stores);
    await act(async () => {
      await Promise.all([getApi().updateBody('first'), getApi().updateBody('second')]);
    });
    // Last-enqueued wins, and disk matches memory (store chain + provider
    // mutation chain prevent interleaved overwrites).
    expect(getApi().draft?.body).toBe('second');
    const disk = await stores.store.loadManifest({ viewerId: 'user_a', spaceId: 'space_1' });
    expect(disk.draft?.body).toBe('second');
    view.unmount();
  });

  it('restore keeps body + stable clientId across remounts', async () => {
    const stores = makeStores();
    const scope: ComposerScope = { viewerId: 'user_a', spaceId: 'space_1' };
    const first = await renderProvider(stores);
    const clientId = first.getApi().draft?.clientId as string;
    await act(async () => {
      await first.getApi().updateBody('still here');
    });
    first.view.unmount();

    const second = await renderProvider(stores);
    expect(second.getApi().draft?.body).toBe('still here');
    expect(second.getApi().draft?.clientId).toBe(clientId);
    const disk = await stores.store.loadManifest(scope);
    expect(disk.draft?.clientId).toBe(clientId);
    second.view.unmount();
  });

  it('scope switch exposes nothing cross-scope and preserves A disk', async () => {
    const stores = makeStores();
    const { view, getApi } = await renderProvider(stores);
    await act(async () => {
      await getApi().updateBody('A private');
    });
    expect(getApi().draft?.body).toBe('A private');

    // Switch accounts: B must see a blank slate, never A's body.
    await act(async () => {
      sessionState.userId = 'user_b';
    });
    // Force a rerender so the provider observes the new scope.
    view.rerender(
      <ComposerProvider deps={{ store: stores.store, now: () => '2026-03-15T10:00:00.000Z' } as never}>
        <Probe onApi={() => {}} />
      </ComposerProvider>
    );
    // Re-mount cleanly with B scope to assert isolation via disk + fresh hydrate.
    view.unmount();
    sessionState.userId = 'user_b';
    const bStores = { ...stores };
    let bApi: ReturnType<typeof useComposer> | null = null;
    const bView = render(
      <ComposerProvider deps={{ store: bStores.store, now: () => '2026-03-15T10:00:00.000Z' } as never}>
        <Probe onApi={(a) => { bApi = a; }} />
      </ComposerProvider>
    );
    await waitFor(() => expect(bApi?.draft).not.toBeNull(), { timeout: 2000 });
    expect(bApi?.draft?.body).toBe('');
    // A disk untouched.
    const aDisk = await stores.store.loadManifest({ viewerId: 'user_a', spaceId: 'space_1' });
    expect(aDisk.draft?.body).toBe('A private');
    bView.unmount();
    sessionState.userId = 'user_a';
  });

  it('editPending rejects a nonempty draft with DRAFT_EXISTS (no data loss)', async () => {
    const stores = makeStores();
    const stubUpload = async () => ({ mediaId: null as string | null, url: 'file:///x' });
    const failCreate = async () => {
      throw Object.assign(new Error('boom'), { code: 'NETWORK' });
    };
    const { view, getApi } = await renderProvider(stores, stubUpload, failCreate);
    await act(async () => {
      await getApi().updateBody('draft v1');
    });
    let saveId = '';
    await act(async () => {
      const r = await getApi().save();
      saveId = r.clientId;
    });
    // Let the background send settle to failed (pending retained, never removed).
    await waitFor(() => expect(getApi().pending.some((p) => p.clientId === saveId && p.status === 'failed')).toBe(true), { timeout: 3000 });
    // New mutable draft after save is fresh-empty; make it nonempty.
    await act(async () => {
      await getApi().updateBody('unsaved work');
    });
    await act(async () => {
      await expect(getApi().editPending(saveId)).rejects.toMatchObject({ code: 'DRAFT_EXISTS' });
    });
    // Nothing lost: pending still present, draft still unsaved work.
    expect(getApi().pending.some((p) => p.clientId === saveId)).toBe(true);
    expect(getApi().draft?.body).toBe('unsaved work');
    // Message contract.
    try {
      await getApi().editPending(saveId);
      expect.unreachable();
    } catch (e) {
      const { userSafeMessage } = await import('@/features/composer/composer-machine');
      expect(userSafeMessage(e)).toBe('Finish or discard your current draft first.');
    }
    view.unmount();
  });

  it('discardPending removes only its own files and preserves the draft', async () => {
    const stores = makeStores();
    const stubUpload = async () => ({ mediaId: null as string | null, url: 'file:///x' });
    const failCreate = async () => {
      throw Object.assign(new Error('boom'), { code: 'NETWORK' });
    };
    const { view, getApi } = await renderProvider(stores, stubUpload, failCreate);
    await act(async () => {
      await getApi().addAssets([{ uri: 'file:///pick.jpg', mimeType: 'image/jpeg' }]);
    });
    const stagedUri = getApi().draft?.assets[0]?.localUri as string;
    expect(stagedUri).toContain('staged');
    let pendingId = '';
    await act(async () => {
      await getApi().updateBody('to send');
      const r = await getApi().save();
      pendingId = r.clientId;
    });
    await waitFor(() => expect(getApi().pending.some((p) => p.clientId === pendingId && p.status === 'failed')).toBe(true), { timeout: 3000 });
    // Draft is fresh-empty after save; give it unrelated work that must survive.
    await act(async () => {
      await getApi().updateBody('keep me');
    });
    await act(async () => {
      await getApi().discardPending(pendingId);
    });
    expect(getApi().pending).toEqual([]);
    expect(getApi().draft?.body).toBe('keep me');
    expect(await stores.fileStore.exists(stagedUri)).toBe(false);
    view.unmount();
  });

  it('corrupt manifest fails closed (leave bytes, no pretend success) until explicit reset', async () => {
    const stores = makeStores();
    const scope: ComposerScope = { viewerId: 'user_a', spaceId: 'space_1' };
    const { view, getApi } = await renderProvider(stores);
    await act(async () => {
      await getApi().updateBody('precious');
    });
    const rawBefore = await stores.fileStore.readText('composer/user_a/space_1/manifest.enc');
    expect(rawBefore).toBeTruthy();
    view.unmount();

    // Tamper ciphertext → CORRUPT on next hydrate (proven pattern from crypto test).
    const tampered = `${(rawBefore as string).slice(0, -4)}AAAA`;
    await stores.fileStore.writeAtomic('composer/user_a/space_1/manifest.enc', tampered);
    let corruptApi: ReturnType<typeof useComposer> | null = null;
    const corruptView = render(
      <ComposerProvider deps={{ store: stores.store, now: () => '2026-03-15T10:00:00.000Z' } as never}>
        <Probe onApi={(a) => { corruptApi = a; }} />
      </ComposerProvider>
    );
    await waitFor(() => expect(corruptApi?.error).not.toBeNull(), { timeout: 2000 });
    expect(corruptApi?.draft).toBeNull();
    // Fail closed: writes throw typed errors, bytes untouched, no success pretend.
    await expect(corruptApi!.updateBody('overwrite')).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' });
    const rawAfter = await stores.fileStore.readText('composer/user_a/space_1/manifest.enc');
    expect(rawAfter).toBe(tampered);
    // Explicit reset recovers to fresh empty.
    await act(async () => {
      await corruptApi!.resetCorrupt();
    });
    expect(corruptApi?.draft?.body).toBe('');
    expect(corruptApi?.error).toBeNull();
    corruptView.unmount();
    // Key-loss fail-closed at the store level: existing bytes + lost key never overwrites.
    const ks = createMemoryKeyStore();
    const fs = createMemoryFileStore();
    const s1 = new ComposerStore({ keyStore: ks, fileStore: fs, crypto: memoryComposerCrypto });
    await s1.saveManifest(scope, { clientId: 'm1', body: 'keep', occurredAt: '2026-03-15T10:00:00.000Z', assets: [], updatedAt: '2026-03-15T10:00:00.000Z' }, []);
    const bytesBefore = await fs.readText('composer/user_a/space_1/manifest.enc');
    ks.clear();
    await expect(
      s1.saveManifest(scope, { clientId: 'm2', body: 'overwrite', occurredAt: '2026-03-15T10:00:00.000Z', assets: [], updatedAt: '2026-03-15T10:00:00.000Z' }, [])
    ).rejects.toMatchObject({ code: 'KEY_UNAVAILABLE' });
    expect(await fs.readText('composer/user_a/space_1/manifest.enc')).toBe(bytesBefore);
  });

  it('retains delivered pending with the server moment until acknowledged (no disappearance)', async () => {
    const stores = makeStores();
    const stubUpload = async () => ({ mediaId: null as string | null, url: 'file:///x' });
    const serverMoment = {
      id: 'moment_delivered_1',
      type: 'note',
      title: '',
      body: 'hello',
      occurredAt: '2026-03-15T10:00:00.000Z',
      createdAt: '2026-03-15T10:00:00.000Z',
      updatedAt: '2026-03-15T10:00:00.000Z',
      authorId: 'user_a',
    };
    const okCreate = async () => serverMoment as never;
    const { view, getApi } = await renderProvider(stores, stubUpload, okCreate);
    await act(async () => {
      await getApi().updateBody('hello');
    });
    let clientId = '';
    await act(async () => {
      const r = await getApi().save();
      clientId = r.clientId;
    });
    // Delivered retention: still present with the server moment, not removed.
    await waitFor(
      () =>
        expect(
          getApi().pending.some(
            (item) => item.clientId === clientId && item.status === 'delivered'
          )
        ).toBe(true),
      { timeout: 3000 }
    );
    const kept = getApi().pending.find((item) => item.clientId === clientId);
    expect((kept as { deliveredMoment?: { id: string } }).deliveredMoment?.id).toBe(
      'moment_delivered_1'
    );
    // Retry is a no-op once delivered; edit/discard reject explicit.
    await act(async () => {
      await getApi().retry(clientId);
    });
    expect(getApi().pending.some((item) => item.clientId === clientId)).toBe(true);
    await act(async () => {
      await expect(getApi().editPending(clientId)).rejects.toMatchObject({ code: 'CORRUPT' });
    });
    // Explicit acknowledge drops the row (timeline already rendered the id).
    await act(async () => {
      await getApi().acknowledgeDelivered(clientId);
    });
    expect(getApi().pending.some((item) => item.clientId === clientId)).toBe(false);
    view.unmount();
  });
});
