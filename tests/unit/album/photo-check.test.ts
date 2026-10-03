import { describe, expect, it, vi } from 'vitest';

import { checkPhotoCrops } from '@/features/album/photo-check';

function fixture(count = 2) {
  return {
    engine: { isAvailable: vi.fn(async () => true), detect: vi.fn(async () => Array.from({ length: count }, (_, x) => ({ x, y: 0, width: 100, height: 100, rollAngle: 0 }))) },
    uri: 'file:///local-photo', signal: new AbortController().signal, preview: vi.fn(async () => 'data:image/png;base64,crop'),
  };
}

describe('simple local photo check', () => {
  it('shows both aligned crops without identity scores', async () => {
    const input = fixture();
    expect(await checkPhotoCrops(input)).toEqual({ kind: 'ready', detected: 2, crops: [{ face: 1, uri: 'data:image/png;base64,crop' }, { face: 2, uri: 'data:image/png;base64,crop' }] });
    expect(input.preview).toHaveBeenCalledTimes(2);
  });
  it('distinguishes no faces, unreadable photos and individual crop failures', async () => {
    expect(await checkPhotoCrops(fixture(0))).toEqual({ kind: 'ready', detected: 0, crops: [] });
    const input = fixture(); input.engine.detect.mockRejectedValue(new Error('private path'));
    expect(await checkPhotoCrops(input)).toEqual({ kind: 'failed', message: 'Could not read this photo. Try choosing it again.' });
    const missing = fixture(); missing.preview.mockRejectedValueOnce(new Error('alignment'));
    expect(await checkPhotoCrops(missing)).toMatchObject({ kind: 'ready', crops: [{ face: 1, uri: null }, { face: 2, uri: 'data:image/png;base64,crop' }] });
  });
  it('limits crop generation and discards canceled results between native operations', async () => {
    const input = fixture(12); await checkPhotoCrops(input); expect(input.preview).toHaveBeenCalledTimes(8);
    const abort = new AbortController();
    input.preview.mockClear().mockImplementation(async () => { abort.abort(); return 'crop'; });
    expect(await checkPhotoCrops({ ...input, signal: abort.signal })).toEqual({ kind: 'cancelled' });
    expect(input.preview).toHaveBeenCalledOnce();
  });
});
