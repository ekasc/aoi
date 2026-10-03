import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSkyPhotos } from '@/features/album/use-sky-photos';
import type { SkyPhoto } from '@/features/album/sky-photo-repository';

const state = vi.hoisted(() => ({
  userId: 'you', spaceId: 'space', list: vi.fn(), importPhotos: vi.fn(), remove: vi.fn(), dispose: vi.fn(), pick: vi.fn(),
}));
vi.mock('@/features/session/session-context', () => ({ useSession: () => ({ user: { id: state.userId } }) }));
vi.mock('@/features/space/space-context', () => ({ useSpace: () => ({ space: { id: state.spaceId } }) }));
vi.mock('@/features/album/sky-photo-store', () => ({ getSkyPhotoRepository: () => ({ list: state.list, importPhotos: state.importPhotos, remove: state.remove, dispose: state.dispose }) }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: state.pick }));
const photo: SkyPhoto = { id: 'local-photo', addedAt: '2026-01-01T00:00:00.000Z', width: 800, height: 600, uri: 'file:///local.jpg' };

beforeEach(() => {
  state.userId = 'you'; state.spaceId = 'space';
  state.list.mockReset().mockResolvedValue([]);
  state.importPhotos.mockReset().mockResolvedValue([photo]);
  state.remove.mockReset().mockResolvedValue(undefined);
  state.dispose.mockReset();
  state.pick.mockReset().mockResolvedValue({ canceled: true, assets: null });
});

describe('local sky photos', () => {
  it('keeps initial loading distinct from successful empty', async () => {
    const { result } = renderHook(useSkyPhotos);
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.photos).toEqual([]);
  });

  it('recovers a read error without leaking storage details', async () => {
    state.list.mockRejectedValueOnce(new Error('private filename'));
    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.readError).not.toContain('filename');
    act(() => result.current.reload());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('uses a selected-only picker and does nothing on cancellation', async () => {
    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.choosePhotos());
    expect(state.pick).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: true, exif: false }));
    expect(state.importPhotos).not.toHaveBeenCalled();
    expect(result.current.actionError).toBeNull();
  });

  it('imports only explicit selections and releases controls after failure', async () => {
    state.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'picker://selected' }] });
    state.importPhotos.mockRejectedValueOnce(new Error('private path'));
    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => result.current.choosePhotos());
    expect(result.current.actionError).toBe('Could not add these photos. Please try again.');
    expect(result.current.operation).toBeNull();
    await act(async () => result.current.choosePhotos());
    expect(state.importPhotos).toHaveBeenCalledWith([{ uri: 'picker://selected' }]);
    expect(result.current.photos).toEqual([photo]);
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
    expect(state.importPhotos).not.toHaveBeenCalled();
    expect(result.current.actionError).toBe('Choose up to 12 photos at a time. None were added.');
    expect(result.current.operation).toBeNull();
  });

  it('hides old scope photos immediately and ignores a late read', async () => {
    state.list.mockResolvedValueOnce([photo]);
    const { result, rerender } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.photos).toEqual([photo]));
    let finish: (value: SkyPhoto[]) => void = () => {};
    state.list.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    act(() => result.current.reload());
    state.userId = 'other';
    rerender();
    expect(result.current.photos).toEqual([]);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => finish([photo]));
    expect(result.current.photos).toEqual([]);
  });

  it('does not import a selection if the account changes while the picker is open', async () => {
    let finish: (value: unknown) => void = () => {};
    state.pick.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let pending: Promise<void>;
    act(() => { pending = result.current.choosePhotos(); });
    state.spaceId = 'new-space'; rerender();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { finish({ canceled: false, assets: [{ uri: 'picker://private' }] }); await pending; });
    expect(state.importPhotos).not.toHaveBeenCalled();
    expect(result.current.photos).toEqual([]);
  });

  it('does not publish old-scope imports after the space changes', async () => {
    state.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'picker://selected' }] });
    let finish: (value: SkyPhoto[]) => void = () => {};
    state.importPhotos.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let pending: Promise<void>;
    act(() => { pending = result.current.choosePhotos(); });
    await waitFor(() => expect(state.importPhotos).toHaveBeenCalledOnce());
    state.spaceId = 'new-space'; rerender();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { finish([photo]); await pending; });
    expect(result.current.photos).toEqual([]);
  });

  it('removes a copy without saving a memory or sharing anything', async () => {
    state.list.mockResolvedValueOnce([photo]);
    const { result } = renderHook(useSkyPhotos);
    await waitFor(() => expect(result.current.photos.length).toBe(1));
    await act(async () => result.current.removePhoto(photo.id));
    expect(state.remove).toHaveBeenCalledWith(photo.id);
    expect(result.current.photos).toEqual([]);
  });
});
