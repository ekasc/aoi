import { beforeEach, describe, expect, it, vi } from 'vitest';

import { automaticPhotoLibrary } from '@/features/album/automatic-photo-library.native';

const state = vi.hoisted(() => ({ permission: vi.fn(), request: vi.fn(), assets: vi.fn(), info: vi.fn(), listen: vi.fn(), remove: vi.fn() }));
vi.mock('expo-media-library/legacy', () => ({
  getPermissionsAsync: state.permission, requestPermissionsAsync: state.request, getAssetsAsync: state.assets,
  getAssetInfoAsync: state.info, addListener: state.listen,
}));
beforeEach(() => {
  state.permission.mockReset().mockResolvedValue({ granted: true, accessPrivileges: 'all' });
  state.request.mockReset().mockResolvedValue({ granted: false });
  state.assets.mockReset().mockResolvedValue({ assets: [{ id: 'asset', modificationTime: 123 }], hasNextPage: true, endCursor: 'next' });
  state.info.mockReset().mockResolvedValue({ localUri: 'file:///local.jpg' });
  state.remove.mockReset(); state.listen.mockReset().mockReturnValue({ remove: state.remove });
});
describe('read-only automatic photo access', () => {
  it('checks permission without prompting unless explicitly requested', async () => {
    expect(await automaticPhotoLibrary.permission(false)).toBe('full'); expect(state.request).not.toHaveBeenCalled();
    expect(await automaticPhotoLibrary.permission(true)).toBe('denied'); expect(state.request).toHaveBeenCalledWith(false, ['photo']);
  });
  it('preserves limited access', async () => {
    state.permission.mockResolvedValue({ granted: true, accessPrivileges: 'limited' });
    expect(await automaticPhotoLibrary.permission(false)).toBe('limited');
  });
  it('enumerates only photos in bounded pages and exposes no coordinates or EXIF', async () => {
    expect(await automaticPhotoLibrary.page('cursor')).toEqual({ photos: [{ id: 'asset', version: '123' }], next: 'next' });
    expect(state.assets).toHaveBeenCalledWith({ first: 40, after: 'cursor', mediaType: ['photo'], sortBy: [['creationTime', false]] });
  });
  it('never downloads iCloud originals or passes non-file URIs to recognition', async () => {
    expect(await automaticPhotoLibrary.localUri('asset')).toBe('file:///local.jpg');
    expect(state.info).toHaveBeenCalledWith('asset', { shouldDownloadFromNetwork: false });
    state.info.mockResolvedValue({ localUri: 'ph://asset' }); expect(await automaticPhotoLibrary.localUri('asset')).toBeNull();
  });
  it('removes only its own library listener', () => {
    const stop = automaticPhotoLibrary.subscribe(() => {}); stop(); expect(state.remove).toHaveBeenCalledOnce();
  });
  it('asks PhotoKit for newest-first photos since local midnight, including the start-date boundary, on every page', async () => {
    const since = new Date(2024, 5, 1).getTime();
    state.assets.mockResolvedValue({ assets: [{ id: 'recent', modificationTime: 123 }], hasNextPage: true, endCursor: 'recent', totalCount: 25 });
    expect(await automaticPhotoLibrary.page(undefined, since)).toMatchObject({ total: 25 });
    await automaticPhotoLibrary.page('recent', since);
    expect(state.assets).toHaveBeenNthCalledWith(1, { first: 40, after: undefined, mediaType: ['photo'], sortBy: [['creationTime', false]], createdAfter: since - 1 });
    expect(state.assets).toHaveBeenNthCalledWith(2, { first: 40, after: 'recent', mediaType: ['photo'], sortBy: [['creationTime', false]], createdAfter: since - 1 });
  });
});
