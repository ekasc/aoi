import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareSkyPhoto } from '@/features/album/sky-photo-import';

const state = vi.hoisted(() => ({ manipulate: vi.fn(), render: vi.fn(), resize: vi.fn(), releaseContext: vi.fn(), releaseImage: vi.fn(), save: vi.fn() }));
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: state.manipulate }, SaveFormat: { JPEG: 'jpeg' },
}));

beforeEach(() => {
  state.save.mockReset().mockResolvedValue({ uri: 'file:///reencoded.jpg', width: 800, height: 600 });
  state.releaseImage.mockReset(); state.releaseContext.mockReset(); state.resize.mockReset();
  state.render.mockReset().mockResolvedValue({ width: 800, height: 600, saveAsync: state.save, release: state.releaseImage });
  state.manipulate.mockReset().mockReturnValue({ renderAsync: state.render, resize: state.resize, release: state.releaseContext });
});

describe('selected sky photo preparation', () => {
  it('re-encodes selected pixels instead of retaining an original library file', async () => {
    expect(await prepareSkyPhoto('picker://original')).toMatchObject({ uri: 'file:///reencoded.jpg' });
    expect(state.manipulate).toHaveBeenCalledWith('picker://original');
    expect(state.save).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.9 });
    expect(state.resize).not.toHaveBeenCalled();
    expect(state.releaseImage).toHaveBeenCalledOnce();
    expect(state.releaseContext).toHaveBeenCalledOnce();
  });

  it('bounds a landscape image to 2048 pixels on its longest side', async () => {
    state.render.mockResolvedValueOnce({ width: 6000, height: 4000, saveAsync: state.save, release: state.releaseImage });
    await prepareSkyPhoto('picker://large');
    expect(state.resize).toHaveBeenCalledWith({ width: 2048 });
    expect(state.render).toHaveBeenCalledTimes(2);
    expect(state.releaseImage).toHaveBeenCalledTimes(2);
  });

  it('bounds portrait images by height', async () => {
    state.render.mockResolvedValueOnce({ width: 3000, height: 5000, saveAsync: state.save, release: state.releaseImage });
    await prepareSkyPhoto('picker://portrait');
    expect(state.resize).toHaveBeenCalledWith({ height: 2048 });
  });

  it('releases native resources when encoding fails', async () => {
    state.save.mockRejectedValueOnce(new Error('encode failed'));
    await expect(prepareSkyPhoto('picker://broken')).rejects.toThrow('encode failed');
    expect(state.releaseImage).toHaveBeenCalledOnce();
    expect(state.releaseContext).toHaveBeenCalledOnce();
  });

  it('releases the native context when decoding fails', async () => {
    state.render.mockRejectedValueOnce(new Error('decode failed'));
    await expect(prepareSkyPhoto('picker://broken')).rejects.toThrow('decode failed');
    expect(state.releaseImage).not.toHaveBeenCalled();
    expect(state.releaseContext).toHaveBeenCalledOnce();
  });
});
