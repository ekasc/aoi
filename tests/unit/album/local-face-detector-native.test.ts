import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ platform: 'ios', requireModule: vi.fn() }));
vi.mock('expo', () => ({ requireOptionalNativeModule: native.requireModule }));
vi.mock('react-native', () => ({ Platform: { get OS() { return native.platform; } } }));

beforeEach(() => {
  vi.resetModules();
  native.platform = 'ios';
  native.requireModule.mockReset().mockReturnValue(null);
});

describe('native face detector availability', () => {
  it('remains unavailable when the iOS binary does not include the module', async () => {
    const { localFaceDetector } = await import('@/features/album/local-face-detector.native');
    expect(native.requireModule).toHaveBeenCalledExactlyOnceWith('AoiFaceDetector');
    expect(localFaceDetector.isAvailable()).toBe(false);
    await expect(localFaceDetector.detect('file:///photo.jpg')).rejects.toThrow('unavailable');
  });

  it('uses the optional module in a supporting iOS binary', async () => {
    const result = { width: 800, height: 600, faces: [] };
    const detect = vi.fn(async () => result);
    native.requireModule.mockReturnValue({ detect });
    const { localFaceDetector } = await import('@/features/album/local-face-detector.native');
    expect(localFaceDetector.isAvailable()).toBe(true);
    expect(await localFaceDetector.detect('file:///photo.jpg')).toEqual(result);
    expect(detect).toHaveBeenCalledExactlyOnceWith('file:///photo.jpg');
  });

  it('does not look for an iOS module on Android', async () => {
    native.platform = 'android';
    const { localFaceDetector } = await import('@/features/album/local-face-detector.native');
    expect(localFaceDetector.isAvailable()).toBe(false);
    expect(native.requireModule).not.toHaveBeenCalled();
  });
});
