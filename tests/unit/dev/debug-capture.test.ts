import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestScreenshot, screenshot } from '@/features/dev/debug-capture';

const viewShot = vi.hoisted(() => ({
  captureScreen: vi.fn(),
}));
const legacyFileSystem = vi.hoisted(() => ({
  uploadAsync: vi.fn(),
  copyAsync: vi.fn(),
  cacheDirectory: '/mock-cache/',
  documentDirectory: null,
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  FileSystemSessionType: { FOREGROUND: 1 },
}));
const elementTree = vi.hoisted(() => ({ captureAccessibilityInventory: vi.fn() }));

vi.mock('react-native-view-shot', () => viewShot);
vi.mock('expo-file-system/legacy', () => legacyFileSystem);
vi.mock('@/features/dev/element-tree', () => elementTree);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { hostUri: '127.0.0.1:8081' }, manifest: {} },
}));

const fetchMock = vi.fn();

describe('debug screenshot upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      json: async () => ({ ok: true, metaPath: '/screenshots/test.json' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    elementTree.captureAccessibilityInventory.mockReturnValue({
      available: true,
      platform: 'ios',
      window: { width: 390, height: 844 },
      captured: '2026-01-01T00:00:00.000Z',
      count: 1,
      truncated: false,
      elements: [{ path: 'App', role: 'button', label: 'Go back' }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads a reduced tmpfile JPEG as binary, then posts small metadata', async () => {
    viewShot.captureScreen.mockResolvedValue('file:///tmp/aoi-shot.jpg');
    legacyFileSystem.uploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ ok: true, path: '/screenshots/test.jpg' }),
      headers: {},
      mimeType: 'image/jpeg',
    });

    const result = await screenshot('agent');

    expect(result).toStrictEqual({
      ok: true,
      path: '/screenshots/test.jpg',
      metaPath: '/screenshots/test.json',
      accessibilityCount: 1,
    });
    expect(viewShot.captureScreen).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'jpg', result: 'tmpfile' })
    );
    expect(legacyFileSystem.uploadAsync).toHaveBeenCalledWith(
      expect.stringContaining('/__aoi_debug/screenshot-upload?id='),
      expect.stringContaining('/mock-cache/aoi-debug-screenshot-'),
      expect.objectContaining({
        httpMethod: 'POST',
        uploadType: legacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': 'image/jpeg' },
        sessionType: legacyFileSystem.FileSystemSessionType.FOREGROUND,
      })
    );
    const uploadedUri = legacyFileSystem.uploadAsync.mock.calls[0][1];
    expect(legacyFileSystem.copyAsync).toHaveBeenCalledWith({
      from: 'file:///tmp/aoi-shot.jpg',
      to: uploadedUri,
    });
    expect(uploadedUri).not.toBe('file:///tmp/aoi-shot.jpg');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const metadata = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(metadata).not.toHaveProperty('pngBase64');
    expect(metadata.id).toEqual(expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/));
    expect(metadata.accessibility.count).toBe(1);
  });

  it('lets an agent trigger a screenshot without waiting over CDP', async () => {
    viewShot.captureScreen.mockResolvedValue('file:///tmp/aoi-shot.jpg');
    legacyFileSystem.uploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ ok: true, path: '/screenshots/test.jpg' }),
      headers: {},
      mimeType: 'image/jpeg',
    });

    const receipt = requestScreenshot('agent');

    expect(receipt).toEqual({ ok: true, accepted: true, label: 'agent' });
    await vi.waitFor(() => {
      expect(legacyFileSystem.uploadAsync).toHaveBeenCalled();
    });
  });
});
