import { beforeEach, describe, expect, it, vi } from 'vitest';

import { alignedFacePreview } from '@/features/album/aligned-face-preview.native';
import { SFACE_SIZE, SFACE_TEMPLATE } from '@/features/album/face-alignment';

const state = vi.hoisted(() => ({ prepare: vi.fn(), image: vi.fn(), data: vi.fn(), dataDispose: vi.fn(), imageDispose: vi.fn(), encode: vi.fn() }));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => ({ prepareFace: state.prepare }) }));
vi.mock('@shopify/react-native-skia', () => ({
  AlphaType: { Unpremul: 0 }, ColorType: { RGBA_8888: 0 }, ImageFormat: { PNG: 0 },
  Skia: { Data: { fromBytes: state.data }, Image: { MakeImage: state.image } },
}));

beforeEach(() => {
  state.prepare.mockReset().mockResolvedValue(Array(SFACE_SIZE ** 2 * 3).fill(12));
  state.data.mockReset().mockImplementation((bytes: Uint8Array) => ({ dispose: state.dataDispose, bytes }));
  state.image.mockReset().mockReturnValue({ encodeToBase64: state.encode, dispose: state.imageDispose });
  state.encode.mockReset().mockReturnValue('encoded-preview');
  state.dataDispose.mockClear(); state.imageDispose.mockClear();
});

describe('native aligned preview adapter', () => {
  it('uses the exact native preparation transform and 112px geometry, then releases buffers and Skia resources', async () => {
    const face = { x: 0, y: 0, width: 112, height: 112, rollAngle: 0, landmarks: SFACE_TEMPLATE };
    expect(await alignedFacePreview('file:///local-selection', face)).toBe('data:image/png;base64,encoded-preview');
    const transform = state.prepare.mock.calls[0][1];
    expect(transform[0]).toBeCloseTo(1); expect(transform[1]).toBeCloseTo(0);
    expect(transform[2]).toBeCloseTo(0); expect(transform[3]).toBeCloseTo(0);
    expect(state.image.mock.calls[0][0]).toMatchObject({ width: 112, height: 112 });
    expect(state.image.mock.calls[0][2]).toBe(112 * 4);
    const bytes: Uint8Array = state.data.mock.calls[0][0];
    expect(bytes.every((value) => value === 0)).toBe(true);
    expect(state.imageDispose).toHaveBeenCalledOnce(); expect(state.dataDispose).toHaveBeenCalledOnce();
  });

  it('cleans up even when native image construction fails', async () => {
    state.image.mockImplementation(() => { throw new Error('Native allocation failed'); });
    await expect(alignedFacePreview('file:///local-selection', { x: 0, y: 0, width: 112, height: 112, rollAngle: 0, landmarks: SFACE_TEMPLATE })).rejects.toThrow();
    const bytes: Uint8Array = state.data.mock.calls[0][0];
    expect(bytes.every((value) => value === 0)).toBe(true);
    expect(state.dataDispose).toHaveBeenCalledOnce();
  });
});
