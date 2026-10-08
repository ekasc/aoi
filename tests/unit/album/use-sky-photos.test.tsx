import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkyPhoto } from '@/features/album/sky-photo-repository';

const state = vi.hoisted(() => ({
  userId: 'you',
  spaceId: 'space',
  establish: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  open: vi.fn(),
  storeList: vi.fn(),
  storeRemove: vi.fn(),
  dispose: vi.fn(),
  sealUpload: vi.fn(),
  prepare: vi.fn(),
  pick: vi.fn(),
}));

vi.mock('@/features/session/session-context', () => ({ useSession: () => ({ user: { id: state.userId } }) }));
vi.mock('@/features/space/space-context', () => ({ useSpace: () => ({ space: { id: state.spaceId } }) }));
// The signed archive is exercised by its own suite; here it is stubbed so the
// hook's legacy behaviour is what is under test, and so no test makes a real
// network attempt.
const protocol = vi.hoisted(() => ({
  establish: vi.fn(async () => ({ status: 'unavailable' })),
  read: vi.fn(async () => ({ photos: [], deleted: [], rejected: [], incomplete: false })),
  remove: vi.fn(async () => {}),
  upload: vi.fn(async () => {}),
}));
vi.mock('@/features/album/protocol-archive', () => ({
  establishProtocolArchive: protocol.establish,
  readProtocolArchive: protocol.read,
  removeProtocolPhoto: protocol.remove,
  uploadProtocolPhoto: protocol.upload,
  ProtocolUploadInterrupted: class ProtocolUploadInterrupted extends Error {},
}));
vi.mock('@/features/album/album-session', () => ({
  establishAlbumSession: state.establish,
  sealAndUploadPhoto: state.sealUpload,
  openPhoto: state.open,
}));
vi.mock('@/features/album/album-photo-store', () => ({  createAlbumPhotoStore: () => ({ list: state.storeList, removeCached: state.storeRemove, dispose: state.dispose }),
}));
vi.mock('@/features/album/sky-photo-import', () => ({ prepareSkyPhoto: state.prepare }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: state.pick }));

const { useSkyPhotos } = await import('@/features/album/use-sky-photos');

const photo: SkyPhoto = { id: 'shared-photo', addedAt: '2026-01-01T00:00:00.000Z', width: 800, height: 600, uri: 'blob:shared-photo' };
const prepared = { uri: 'prepared://photo.jpg', width: 800, height: 600 };

function readySession() {
  return {
    status: 'ready' as const,
    device: {},
    spaceKey: new Uint8Array(32),
    client: { list: state.list, remove: state.remove, fetchObject: vi.fn() },
  };
}

beforeEach(() => {
  state.userId = 'you';
  state.spaceId = 'space';
  state.establish.mockReset().mockResolvedValue(readySession());
  state.list.mockReset().mockResolvedValue([]);
  state.remove.mockReset().mockResolvedValue(undefined);
  state.storeList.mockReset().mockResolvedValue([]);
  state.storeRemove.mockReset().mockResolvedValue(undefined);
  state.dispose.mockReset();
  state.sealUpload.mockReset().mockResolvedValue(undefined);
  state.prepare.mockReset().mockResolvedValue(prepared);
  state.pick.mockReset().mockResolvedValue({ canceled: true, assets: null });
  protocol.establish.mockReset().mockResolvedValue({ status: 'unavailable' });
  protocol.read.mockReset().mockResolvedValue({ photos: [], deleted: [], rejected: [], incomplete: false });
  protocol.remove.mockReset().mockResolvedValue(undefined);
  protocol.upload.mockReset().mockResolvedValue(undefined);
});

describe('shared sky photos', () => {
  it('keeps initial loading distinct from successful empty', async () => {
    const { result } = renderHook(useSkyPhotos);
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.photos).toEqual([]);
  });

  it('treats a partner not yet set up as an empty ready sky, not an error', async () => {
    state.establish.mockResolvedValueOnce({ status: 'waiting' });
    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.photos).toEqual([]);
    expect(result.current.readError).toBeNull();
  });

  it('recovers a read error without leaking storage details', async () => {
    state.establish.mockRejectedValueOnce(new Error('private filename'));
    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.readError).not.toContain('filename');
    act(() => result.current.reload());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('reports an unreadable archive instead of an empty sky', async () => {
    // Records exist, but none could be opened: the wrong key, or every fetch
    // failing. Presenting that as "you have no photos" hides a full archive
    // that this device cannot read.
    state.list.mockResolvedValueOnce([{ id: 'shared-photo' }]);
    state.storeList.mockRejectedValueOnce(new Error('none of the 1 album records could be opened'));
    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.readError).toBeTruthy();
    expect(result.current.readError).not.toContain('records could be opened');
  });

  it('uses a selected-only picker and does nothing on cancellation', async () => {
    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.choosePhotos());
    expect(state.pick).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: true, exif: false }));
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.sealUpload).not.toHaveBeenCalled();
    expect(result.current.actionError).toBeNull();
  });

  it('re-encodes, seals, uploads, and refreshes the shared list', async () => {
    state.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'picker://selected' }] });
    state.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'shared-photo' }]);
    state.storeList.mockResolvedValueOnce([]).mockResolvedValueOnce([photo]);
    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.choosePhotos());
    expect(state.prepare).toHaveBeenCalledWith('picker://selected');
    expect(state.sealUpload).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }), prepared);
    expect(result.current.photos).toEqual([photo]);
    expect(result.current.actionError).toBeNull();
  });

  it('surfaces an upload failure and releases controls for retry', async () => {
    state.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'picker://selected' }] });
    state.sealUpload.mockRejectedValueOnce(new Error('private path'));
    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.choosePhotos());
    expect(result.current.actionError).toBe('Could not add these photos. Please try again.');
    expect(result.current.operation).toBeNull();
    await act(async () => result.current.choosePhotos());
    expect(state.sealUpload).toHaveBeenCalledTimes(2);
    expect(result.current.actionError).toBeNull();
  });

  it('guards duplicate picker opens immediately', async () => {
    let finish: (value: unknown) => void = () => {};
    state.pick.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let pending: Promise<void>;
    act(() => { pending = result.current.choosePhotos(); });
    await act(async () => result.current.choosePhotos());
    expect(state.pick).toHaveBeenCalledOnce();
    expect(result.current.operation).toBe('importing');
    await act(async () => { finish({ canceled: true }); await pending; });
    expect(result.current.operation).toBeNull();
  });

  it('rejects an oversized picker result without adding a partial batch', async () => {
    state.pick.mockResolvedValue({ canceled: false, assets: Array.from({ length: 13 }, (_, index) => ({ uri: `picker://${index}` })) });
    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.choosePhotos());
    expect(state.sealUpload).not.toHaveBeenCalled();
    expect(result.current.actionError).toBe('Choose up to 12 photos at a time. None were added.');
    expect(result.current.operation).toBeNull();
  });

  it('initializes the signed archive even when the legacy session has no partner', async () => {
    // A brand-new Space: no legacy partner, so the old path has nothing. The
    // signed protocol is the only thing that can work, and it must still start.
    state.establish.mockResolvedValue({ status: 'waiting' });
    protocol.establish.mockResolvedValue({ status: 'ready' });

    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(protocol.establish).toHaveBeenCalledWith({ spaceId: 'space' });
    expect(protocol.read).toHaveBeenCalled();
    expect(result.current.protocolStatus).toBe('ready');
  });

  it('surfaces a trust failure instead of silently using the legacy path', async () => {
    protocol.establish.mockResolvedValue({ status: 'blocked' });

    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('failed'));

    expect(result.current.protocolStatus).toBe('blocked');
    expect(result.current.readError).not.toBeNull();
  });

  it('hides old scope photos immediately and ignores a late read', async () => {    state.list.mockResolvedValueOnce([{ id: 'shared-photo' }]);
    state.storeList.mockResolvedValueOnce([photo]);
    const { result, rerender } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.photos).toEqual([photo]));
    let finish: (value: unknown) => void = () => {};
    state.establish.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    act(() => result.current.reload());
    state.userId = 'other';
    rerender();
    expect(result.current.photos).toEqual([]);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => finish({ status: 'waiting' }));
    expect(result.current.photos).toEqual([]);
  });

  it('does not upload a selection if the account changes while the picker is open', async () => {
    let finish: (value: unknown) => void = () => {};
    state.pick.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let pending: Promise<void>;
    act(() => { pending = result.current.choosePhotos(); });
    state.spaceId = 'new-space';
    rerender();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { finish({ canceled: false, assets: [{ uri: 'picker://private' }] }); await pending; });
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.sealUpload).not.toHaveBeenCalled();
    expect(result.current.photos).toEqual([]);
  });

  it('does not publish old-scope uploads after the space changes', async () => {
    state.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'picker://selected' }] });
    let finish: (value: unknown) => void = () => {};
    state.sealUpload.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let pending: Promise<void>;
    act(() => { pending = result.current.choosePhotos(); });
    await waitFor(() => expect(state.sealUpload).toHaveBeenCalledOnce());
    state.spaceId = 'new-space';
    rerender();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { finish(undefined); await pending; });
    expect(result.current.photos).toEqual([]);
  });

  it('removes the shared copy and its cached bytes', async () => {
    state.list.mockResolvedValueOnce([{ id: 'shared-photo' }]);
    state.storeList.mockResolvedValueOnce([photo]);
    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.photos.length).toBe(1));
    await act(async () => result.current.removePhoto(photo.id));
    expect(state.remove).toHaveBeenCalledWith(photo.id);
    expect(state.storeRemove).toHaveBeenCalledWith(photo.id);
    expect(result.current.photos).toEqual([]);
  });
});
