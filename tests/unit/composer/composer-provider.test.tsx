import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { AppState, type AppStateStatus } from 'react-native';

import { ComposerProvider, useComposer } from '@/features/composer/composer-context';
import { ComposerStore } from '@/features/composer/composer-store';
import { withRequestDeadline } from '@/features/request-deadline';
import {
  createMemoryFileStore,
  createMemoryKeyStore,
  memoryComposerCrypto,
} from '@/features/composer/composer-memory-adapters';
import type { ComposerScope, PendingRecord } from '@/features/composer/types';
import { buildPendingFromDraft, newEmptyDraft } from '@/features/composer/composer-machine';

const sessionState = vi.hoisted(() => ({
  userId: 'user_a',
  spaceId: 'space_1',
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
  useSpace: () => ({ space: { id: sessionState.spaceId } }),
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
  sessionState.spaceId = 'space_1';
  AppState.currentState = 'active';
  addMomentMock.mockClear();
  addMomentMock.mockImplementation(async (input: unknown) => ({ id: 'moment_1', ...(input as object) }));
});

describe('composer hydration recovery', () => {
  const scope = { viewerId: 'user_a', spaceId: 'space_1' };
  const now = '2026-03-15T10:00:00.000Z';
  const listeners = new Set<(state: AppStateStatus) => void>();

  beforeEach(() => {
    listeners.clear();
    vi.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => { listeners.delete(listener); } };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function foreground() {
    AppState.currentState = 'active';
    for (const listener of listeners) listener('active');
  }

  async function seed(status: 'sending' | 'queued' | 'failed' | 'delivered') {
    const stores = makeStores();
    const draft = newEmptyDraft('draft_next', now);
    const pending: PendingRecord = {
      ...buildPendingFromDraft({ ...draft, clientId: 'interrupted', body: 'keep me' }, scope, now),
      status,
      ...(status === 'delivered' ? {
        deliveredMoment: {
          id: 'already_delivered', type: 'note', title: '', body: 'keep me',
          occurredAt: now, createdAt: now, authorId: scope.viewerId,
          authorRole: 'you', authorName: 'A',
        },
      } : {}),
    };
    await stores.store.saveManifest(scope, draft, [pending]);
    return stores;
  }

  it.each(['sending', 'queued'] as const)('sends stored %s after active hydration without a foreground event', async (status) => {
    const stores = await seed(status);
    const { view, getApi } = await renderProvider(stores);
    await waitFor(() => expect(getApi().pending[0]?.status).toBe('delivered'));
    expect(addMomentMock).toHaveBeenCalledTimes(1);
    expect(addMomentMock).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'interrupted', body: 'keep me' }));
    expect((await stores.store.loadManifest(scope)).pending[0]?.status).toBe('delivered');
    view.unmount();
  });

  it.each(['failed', 'delivered'] as const)('does not automatically retry stored %s on hydration or foreground', async (status) => {
    const stores = await seed(status);
    const { view, getApi } = await renderProvider(stores);
    await act(async () => { foreground(); });
    expect(addMomentMock).not.toHaveBeenCalled();
    expect(getApi().pending[0]?.status).toBe(status);
    view.unmount();
  });

  it('waits for foreground when hydration completes in the background', async () => {
    AppState.currentState = 'background';
    const stores = await seed('sending');
    const { view, getApi } = await renderProvider(stores);
    expect(getApi().pending[0]?.status).toBe('queued');
    expect(addMomentMock).not.toHaveBeenCalled();
    await act(async () => { foreground(); });
    await waitFor(() => expect(getApi().pending[0]?.status).toBe('delivered'));
    expect(addMomentMock).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it.each(['delivered', 'failed'] as const)('overlapping foreground triggers do not replay a send that becomes %s', async (outcome) => {
    AppState.currentState = 'background';
    const stores = await seed('queued');
    if (outcome === 'failed') addMomentMock.mockRejectedValue(new Error('offline'));
    const { view, getApi } = await renderProvider(stores);
    await act(async () => {
      foreground();
      foreground();
    });
    await waitFor(() => expect(getApi().pending[0]?.status).toBe(outcome));
    await act(async () => { foreground(); });
    expect(addMomentMock).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('foreground during recovery persistence waits for hydration and sends only once', async () => {
    const stores = await seed('sending');
    const saveManifest = stores.store.saveManifest.bind(stores.store);
    let finishRecovery = () => {};
    const recovery = new Promise<void>((resolve) => { finishRecovery = resolve; });
    const save = vi.spyOn(stores.store, 'saveManifest').mockImplementationOnce(async (...args) => {
      await recovery;
      await saveManifest(...args);
    });
    let api: ReturnType<typeof useComposer> | undefined;
    const view = render(
      <ComposerProvider deps={{ store: stores.store }}>
        <Probe onApi={(value) => { api = value; }} />
      </ComposerProvider>
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await act(async () => { foreground(); });
    expect(addMomentMock).not.toHaveBeenCalled();
    expect(api?.hydrating).toBe(true);
    await act(async () => { finishRecovery(); });
    await waitFor(() => expect(api?.pending[0]?.status).toBe('delivered'));
    expect(addMomentMock).toHaveBeenCalledTimes(1);
    expect((await stores.store.loadManifest(scope)).pending[0]?.status).toBe('delivered');
    view.unmount();
  });

  it.each(['account', 'space'] as const)('ignores stale hydration after a %s switch', async (change) => {
    const stores = await seed('sending');
    const loadManifest = stores.store.loadManifest.bind(stores.store);
    let finishHydration = () => {};
    const hydration = new Promise<void>((resolve) => { finishHydration = resolve; });
    const load = vi.spyOn(stores.store, 'loadManifest').mockImplementationOnce(async (...args) => {
      const loaded = await loadManifest(...args);
      await hydration;
      return loaded;
    });
    let api: ReturnType<typeof useComposer> | undefined;
    const tree = (
      <ComposerProvider deps={{ store: stores.store }}>
        <Probe onApi={(value) => { api = value; }} />
      </ComposerProvider>
    );
    const view = render(tree);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    if (change === 'account') sessionState.userId = 'user_b';
    else sessionState.spaceId = 'space_2';
    view.rerender(
      <ComposerProvider deps={{ store: stores.store }}>
        <Probe onApi={(value) => { api = value; }} />
      </ComposerProvider>
    );
    await waitFor(() => expect(api?.hydrating).toBe(false));
    await act(async () => {
      finishHydration();
      await hydration;
      foreground();
    });
    expect(addMomentMock).not.toHaveBeenCalled();
    expect(api?.pending).toEqual([]);
    expect((await loadManifest(scope)).pending[0]?.status).toBe('sending');
    view.unmount();
  });

  it.each(['account', 'space'] as const)('does not start a waiting recovered send after a %s switch', async (change) => {
    const stores = await seed('queued');
    const loaded = await stores.store.loadManifest(scope);
    await stores.store.saveManifest(scope, loaded.draft, [
      ...loaded.pending,
      { ...loaded.pending[0], clientId: 'second_interrupted' },
    ]);
    let finishFirst = () => {};
    const firstSend = new Promise<void>((resolve) => { finishFirst = resolve; });
    addMomentMock.mockImplementation(async (input: unknown) => {
      await firstSend;
      return { id: 'moment_1', ...(input as object) };
    });
    const { view } = await renderProvider(stores);
    await waitFor(() => expect(addMomentMock).toHaveBeenCalledTimes(1));
    if (change === 'account') sessionState.userId = 'user_b';
    else sessionState.spaceId = 'space_2';
    view.rerender(
      <ComposerProvider deps={{ store: stores.store }}>
        <Probe onApi={() => {}} />
      </ComposerProvider>
    );
    await act(async () => {
      finishFirst();
      await firstSend;
    });
    await waitFor(async () => {
      const disk = await stores.store.loadManifest(scope);
      expect(disk.pending[0]?.status).toBe('delivered');
      expect(disk.pending[1]?.status).toBe('queued');
    });
    expect(addMomentMock).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it.each([
    ['account', false], ['account', true], ['space', false], ['space', true],
  ] as const)('does not publish old pending content after a %s switch during persistence, failure=%s', async (change, fails) => {
    const stores = await seed('queued');
    const saveManifest = stores.store.saveManifest.bind(stores.store);
    let finishPersist = () => {};
    const persistence = new Promise<void>((resolve) => { finishPersist = resolve; });
    const save = vi.spyOn(stores.store, 'saveManifest').mockImplementationOnce(async (...args) => {
      await persistence;
      if (fails) throw new Error('disk unavailable');
      await saveManifest(...args);
    });
    const { view } = await renderProvider(stores);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    if (change === 'account') sessionState.userId = 'user_b';
    else sessionState.spaceId = 'space_2';
    let api: ReturnType<typeof useComposer> | undefined;
    view.rerender(
      <ComposerProvider deps={{ store: stores.store }}>
        <Probe onApi={(value) => { api = value; }} />
      </ComposerProvider>
    );
    await waitFor(() => expect(api?.hydrating).toBe(false));
    await act(async () => { finishPersist(); await persistence; });
    await waitFor(() => expect(api?.sendingIds).toEqual([]));
    expect(api?.pending).toEqual([]);
    expect(api?.draft?.body).toBe('');
    expect(api?.error).toBeNull();
    expect(addMomentMock).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe('composer provider durability', () => {
  it('retains a timed-out send and lets the next memory finish', async () => {
    const stores = makeStores();
    const create = vi.fn()
      .mockImplementationOnce(() => withRequestDeadline(
        () => new Promise<never>(() => {}), { timeoutMs: 25 }
      ))
      .mockImplementationOnce(addMomentMock);
    const { view, getApi } = await renderProvider(stores, undefined, create);
    let failedId = '';
    let deliveredId = '';
    await act(async () => {
      await getApi().updateBody('Retain this after the timeout');
      failedId = (await getApi().save()).clientId;
      await getApi().updateBody('The next memory');
      deliveredId = (await getApi().save()).clientId;
    });
    await waitFor(() => {
      expect(getApi().pending.find((item) => item.clientId === failedId)).toMatchObject({
        status: 'failed', errorCode: 'NETWORK_TIMEOUT', body: 'Retain this after the timeout',
      });
      expect(getApi().pending.find((item) => item.clientId === deliveredId)?.status).toBe('delivered');
    });
    const disk = await stores.store.loadManifest({ viewerId: 'user_a', spaceId: 'space_1' });
    expect(disk.pending.find((item) => item.clientId === failedId)?.body).toBe('Retain this after the timeout');
    expect(create).toHaveBeenCalledTimes(2);
    view.unmount();
  });

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
