import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AutomaticAlbumProvider } from '@/features/album/automatic-album-context';
import { useAutomaticAlbum } from '@/features/album/automatic-album-state';
import { SFACE_MODEL_ID } from '@/features/album/face-recognition-engine';
import { SFACE_TEMPLATE } from '@/features/album/face-alignment';

const state = vi.hoisted(() => ({
  userId: 'you', spaceId: 'space', startDate: '2024-06-01' as string | null, load: vi.fn(), save: vi.fn(), forget: vi.fn(), permission: vi.fn(), page: vi.fn(), uri: vi.fn(),
  subscribe: vi.fn(), available: vi.fn(), detect: vi.fn(), embed: vi.fn(), dispose: vi.fn(), pick: vi.fn(), importPhotos: vi.fn(),
  crop: vi.fn(),
}));
vi.mock('@/features/session/session-context', () => ({ useSession: () => ({ user: { id: state.userId } }) }));
vi.mock('@/features/space/space-context', () => ({ useSpace: () => ({ space: { id: state.spaceId, relationshipStartDate: state.startDate } }) }));
vi.mock('@/features/album/automatic-album-storage', () => ({ getAutomaticAlbumStorage: () => ({
  loadEnrollment: state.load, saveEnrollment: state.save, forgetEnrollment: state.forget,
  loadDecisions: async () => ({}), saveDecisions: async () => {},
}) }));
vi.mock('@/features/album/automatic-photo-library', () => ({ automaticPhotoLibrary: {
  permission: state.permission, page: state.page, localUri: state.uri, subscribe: state.subscribe,
} }));
vi.mock('@/features/album/local-face-recognition', () => ({ createLocalFaceRecognition: () => ({
  modelId: SFACE_MODEL_ID, isAvailable: state.available, detect: state.detect, embed: state.embed, dispose: state.dispose,
}) }));
vi.mock('@/features/album/sky-photo-store', () => ({ getSkyPhotoRepository: () => ({
  list: async () => [], importPhotos: state.importPhotos, dispose: () => {},
}) }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: state.pick }));
vi.mock('@/features/album/aligned-face-preview', () => ({ alignedFacePreview: state.crop }));
vi.mock('@/features/album/reference-photo', () => ({
  inspectFaceReference: async () => ({ width: 112, height: 112, faces: await state.detect() }),
  referencePhotoStore: () => ({
    create: async (_uri: string, _photo: unknown, assessment: unknown) => ({ id: 'preview', uri: 'file:///preview', assessment }),
    load: async () => ({ you: null, partner: null }), save: async () => {}, discard: () => {}, clear: async () => {},
  }),
}));
const vector = (index: number) => { const v = new Float32Array(128); v[index] = 1; return v; };
const face = { x: 0, y: 0, width: 112, height: 112, rollAngle: 0, landmarks: SFACE_TEMPLATE };
beforeEach(() => {
  vi.stubGlobal('__DEV__', true);
  state.userId = 'you'; state.spaceId = 'space';
  state.startDate = '2024-06-01';
  state.load.mockReset().mockResolvedValue(null); state.save.mockReset().mockResolvedValue(undefined); state.forget.mockReset().mockResolvedValue(undefined);
  state.permission.mockReset().mockResolvedValue('full'); state.page.mockReset().mockResolvedValue({ photos: [], next: null });
  state.uri.mockReset().mockResolvedValue('file:///photo'); state.subscribe.mockReset().mockReturnValue(() => {});
  state.available.mockReset().mockResolvedValue(true); state.detect.mockReset().mockResolvedValue([face]);
  state.embed.mockReset().mockResolvedValueOnce(vector(0)).mockResolvedValue(vector(1)); state.dispose.mockReset().mockResolvedValue(undefined);
  state.pick.mockReset().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///reference' }] });
  state.importPhotos.mockReset().mockResolvedValue([]);
  state.crop.mockReset().mockResolvedValue('data:image/png;base64,crop');
});

describe('authenticated automatic album lifecycle', () => {
  it('checks selected crops without embedding identities, importing, saving references, or restarting discovery', async () => {
    state.load.mockResolvedValue({ modelId: SFACE_MODEL_ID, prints: [{ person: 'you', embedding: vector(0) }, { person: 'partner', embedding: vector(1) }] });
    state.detect.mockResolvedValue([face, { ...face, x: 1 }]);
    state.embed.mockImplementation(async (_uri, box) => vector(box.x));
    state.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///private', assetId: 'private-asset-id' }] });
    const { result } = renderHook(useAutomaticAlbum, { wrapper: AutomaticAlbumProvider });
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    const pagesBefore = state.page.mock.calls.length;
    await act(async () => { await result.current?.checkPhoto(); });
    expect(result.current?.photoCheck).toMatchObject({ kind: 'ready', detected: 2, crops: [{ face: 1 }, { face: 2 }] });
    expect(result.current?.status).toBe('paused');
    expect(state.page).toHaveBeenCalledTimes(pagesBefore);
    expect(state.importPhotos).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
    expect(state.embed).not.toHaveBeenCalled();
    act(() => result.current?.clearPhotoCheck());
    expect(result.current?.photoCheck).toBeNull();
  });
  it('cancels a check during native crop work without retaining crops', async () => {
    state.load.mockResolvedValue({ modelId: SFACE_MODEL_ID, prints: [{ person: 'you', embedding: vector(0) }, { person: 'partner', embedding: vector(1) }] });
    let finishCrop: ((value: string) => void) | undefined;
    state.crop.mockImplementation(() => new Promise<string>((resolve) => { finishCrop = resolve; }));
    const { result } = renderHook(useAutomaticAlbum, { wrapper: AutomaticAlbumProvider });
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    let running: Promise<void> | undefined;
    act(() => { running = result.current?.checkPhoto(); });
    await waitFor(() => expect(state.crop).toHaveBeenCalledOnce());
    act(() => result.current?.cancelPhotoCheck());
    await act(async () => { finishCrop?.('data:image/png;base64,crop'); await running; });
    expect(result.current?.photoCheck).toEqual({ kind: 'cancelled' });
    expect(result.current?.checkingPhoto).toBe(false);
    expect(result.current?.busy).toBe(false);
    expect(state.embed).not.toHaveBeenCalled();
  });
  it('clears pending previews on exit and ignores a late native crop result', async () => {
    state.load.mockResolvedValue({ modelId: SFACE_MODEL_ID, prints: [{ person: 'you', embedding: vector(0) }, { person: 'partner', embedding: vector(1) }] });
    let finishCrop: ((value: string) => void) | undefined;
    state.crop.mockImplementation(() => new Promise<string>((resolve) => { finishCrop = resolve; }));
    const { result } = renderHook(useAutomaticAlbum, { wrapper: AutomaticAlbumProvider });
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    let running: Promise<void> | undefined;
    act(() => { running = result.current?.checkPhoto(); });
    await waitFor(() => expect(state.crop).toHaveBeenCalledOnce());
    act(() => result.current?.clearPhotoCheck());
    await act(async () => { finishCrop?.('data:image/png;base64,crop'); await running; });
    expect(result.current?.photoCheck).toBeNull();
    expect(result.current?.busy).toBe(false);
    expect(state.embed).not.toHaveBeenCalled();
  });
  it('does not expose uncalibrated automatic recognition in production', async () => {
    vi.stubGlobal('__DEV__', false);
    const { result } = renderHook(useAutomaticAlbum, { wrapper: AutomaticAlbumProvider });
    expect(result.current).toBeNull();
    expect(state.load).not.toHaveBeenCalled(); expect(state.permission).not.toHaveBeenCalled();
  });
  it('does not request permission, inspect the library, or load the model before setup', async () => {
    const { result } = renderHook(useAutomaticAlbum, { wrapper: AutomaticAlbumProvider });
    await waitFor(() => expect(result.current?.status).toBe('off'));
    expect(state.available).not.toHaveBeenCalled(); expect(state.permission).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled(); expect(state.subscribe).not.toHaveBeenCalled();
  });
  it('requires both references, requests permission only on enable, then scans automatically', async () => {
    const { result } = renderHook(useAutomaticAlbum, { wrapper: AutomaticAlbumProvider });
    await waitFor(() => expect(result.current?.status).toBe('off'));
    await act(async () => { await result.current?.enable(); }); expect(state.save).not.toHaveBeenCalled();
    await act(async () => { await result.current?.chooseReference('you'); await result.current?.chooseReference('partner'); });
    expect(result.current?.references).toEqual({ you: true, partner: true }); expect(state.permission).not.toHaveBeenCalled();
    await act(async () => { await result.current?.enable(); });
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    expect(state.permission).toHaveBeenCalledWith(true); expect(state.permission).toHaveBeenCalledWith(false);
    expect(result.current?.enabled).toBe(true); expect(state.page).toHaveBeenCalledOnce();
    expect(state.page).toHaveBeenCalledWith(undefined, new Date(2024, 5, 1).getTime());
  });
  it('does not enable or persist faceprints after permission denial', async () => {
    state.permission.mockResolvedValue('denied');
    const { result } = renderHook(useAutomaticAlbum, { wrapper: AutomaticAlbumProvider });
    await waitFor(() => expect(result.current?.status).toBe('off'));
    await act(async () => { await result.current?.chooseReference('you'); await result.current?.chooseReference('partner'); await result.current?.enable(); });
    expect(result.current?.enabled).toBe(false); expect(result.current?.status).toBe('permission-denied');
    expect(state.save).not.toHaveBeenCalled(); expect(state.page).not.toHaveBeenCalled();
  });
  it('restores opted-in setup and checks new photos without opening a picker', async () => {
    state.load.mockResolvedValue({ modelId: SFACE_MODEL_ID, prints: [{ person: 'you', embedding: vector(0) }, { person: 'partner', embedding: vector(1) }] });
    const { result } = renderHook(useAutomaticAlbum, { wrapper: AutomaticAlbumProvider });
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    expect(state.page).toHaveBeenCalledOnce(); expect(state.pick).not.toHaveBeenCalled(); expect(state.permission).not.toHaveBeenCalledWith(true);
    const changed = state.subscribe.mock.calls[0][0];
    act(() => changed());
    await waitFor(() => expect(state.page).toHaveBeenCalledTimes(2));
  });
  it('turns off, forgets secure references, and unsubscribes from the library', async () => {
    const stop = vi.fn(); state.subscribe.mockReturnValue(stop);
    state.load.mockResolvedValue({ modelId: SFACE_MODEL_ID, prints: [{ person: 'you', embedding: vector(0) }, { person: 'partner', embedding: vector(1) }] });
    const { result } = renderHook(useAutomaticAlbum, { wrapper: AutomaticAlbumProvider });
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    await act(async () => { await result.current?.disable(); });
    expect(result.current?.enabled).toBe(false); expect(state.forget).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
    act(() => result.current?.retry()); expect(state.page).toHaveBeenCalledOnce();
  });
  it('does not retain a completed reference from an old scope', async () => {
    const { result, rerender } = renderHook(useAutomaticAlbum, { wrapper: AutomaticAlbumProvider });
    await waitFor(() => expect(result.current?.status).toBe('off'));
    await act(async () => { await result.current?.chooseReference('you'); });
    expect(result.current?.references.you).toBe(true);
    state.userId = 'another'; rerender();
    await waitFor(() => expect(result.current?.status).toBe('off'));
    expect(result.current?.references.you).toBe(false);
  });
  it('exposes the person being assessed while native work is pending, then keeps failures beside that person', async () => {
    let rejectAssessment: ((error: Error) => void) | undefined;
    state.detect.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectAssessment = reject; }));
    const { result } = renderHook(useAutomaticAlbum, { wrapper: AutomaticAlbumProvider });
    await waitFor(() => expect(result.current?.status).toBe('off'));
    let choosing: Promise<void> | undefined;
    await act(async () => { choosing = result.current?.chooseReference('partner'); });
    expect(result.current?.referencePhase).toEqual({ person: 'partner', label: 'Checking face and photo quality…' });
    expect(result.current?.busy).toBe(true);
    await act(async () => { rejectAssessment?.(new Error('private native failure')); await choosing; });
    expect(result.current?.referencePhase).toBeNull();
    expect(result.current?.referenceIssue).toEqual({ person: 'partner', message: 'Could not read this reference photo. Try a different clear photo.' });
    expect(result.current?.references.partner).toBe(false);
    expect(result.current?.busy).toBe(false);
  });
  it('does not silently scan the entire library when the relationship start date is missing', async () => {
    state.startDate = null;
    state.load.mockResolvedValue({ modelId: SFACE_MODEL_ID, prints: [{ person: 'you', embedding: vector(0) }, { person: 'partner', embedding: vector(1) }] });
    const { result } = renderHook(useAutomaticAlbum, { wrapper: AutomaticAlbumProvider });
    await waitFor(() => expect(result.current?.status).toBe('date-required'));
    expect(state.page).not.toHaveBeenCalled(); expect(state.available).not.toHaveBeenCalled();
  });
  it('continues past eight seconds without queueing a timer or waiting between assets', async () => {
    let clock = 0;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    state.load.mockResolvedValue({ modelId: SFACE_MODEL_ID, prints: [{ person: 'you', embedding: vector(0) }, { person: 'partner', embedding: vector(1) }] });
    state.page.mockResolvedValue({ photos: [{ id: 'newest', version: '1' }, { id: 'older', version: '1' }], next: null, total: 2 });
    state.uri.mockImplementation(async () => { clock += 9000; return 'file:///photo'; });
    state.detect.mockResolvedValue([]);
    try {
      const { result } = renderHook(useAutomaticAlbum, { wrapper: AutomaticAlbumProvider });
      await waitFor(() => expect(result.current?.status).toBe('ready'));
      expect(state.uri.mock.calls.map(([id]) => id)).toEqual(['newest', 'older']);
      expect(result.current?.progress).toMatchObject({ visited: 2, checked: 2 });
    } finally { now.mockRestore(); }
  });
});
