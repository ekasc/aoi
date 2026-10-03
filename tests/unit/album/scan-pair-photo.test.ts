import { describe, expect, it, vi } from 'vitest';

import { type FaceBox, type FacePipeline, type Faceprint } from '@/features/album/face-pipeline';
import { scanPairPhoto } from '@/features/album/scan-pair-photo';

const you = new Float32Array([1, 0, 0]);
const partner = new Float32Array([0, 1, 0]);
const prints: Faceprint[] = [{ person: 'you', embedding: you }, { person: 'partner', embedding: partner }];
const box = (x: number): FaceBox => ({ x, y: 0, width: 100, height: 100, rollAngle: 0 });
const boxes = [box(0), box(100)];
const uri = 'file:///private-photo.jpg';

function pipeline(): FacePipeline {
  return {
    isAvailable: vi.fn(async () => true),
    detect: vi.fn(async () => boxes),
    embed: vi.fn(async (_uri, face) => face.x === 0 ? you : partner),
    match: vi.fn(() => { throw new Error('Single-face matching cannot establish a pair'); }),
  };
}

describe('single-photo pair scan', () => {
  it('runs detector and embeddings for one photo through the real pair matcher', async () => {
    const model = pipeline();
    expect(await scanPairPhoto({ uri, prints, pipeline: model })).toEqual({
      kind: 'pair', you: { faceIndex: 0, similarity: 1 }, partner: { faceIndex: 1, similarity: 1 },
    });
    expect(model.detect).toHaveBeenCalledExactlyOnceWith(uri);
    expect(model.embed).toHaveBeenNthCalledWith(1, uri, boxes[0]);
    expect(model.embed).toHaveBeenNthCalledWith(2, uri, boxes[1]);
    expect(model.match).not.toHaveBeenCalled();
  });

  it('does not access the photo unless both identities are enrolled', async () => {
    const model = pipeline();
    expect(await scanPairPhoto({ uri, prints: [prints[0]], pipeline: model })).toEqual({ kind: 'enrollment-required' });
    expect(model.isAvailable).not.toHaveBeenCalled();
    expect(model.detect).not.toHaveBeenCalled();
  });

  it('does not simulate recognition when no native model is available', async () => {
    const model = pipeline();
    vi.mocked(model.isAvailable).mockResolvedValue(false);
    expect(await scanPairPhoto({ uri, prints, pipeline: model })).toEqual({ kind: 'unavailable' });
    expect(model.detect).not.toHaveBeenCalled();
  });

  it('returns no-faces without requesting embeddings', async () => {
    const model = pipeline();
    vi.mocked(model.detect).mockResolvedValue([]);
    expect(await scanPairPhoto({ uri, prints, pipeline: model })).toEqual({ kind: 'no-faces' });
    expect(model.embed).not.toHaveBeenCalled();
  });

  it('does not call a single-person match a pair', async () => {
    const model = pipeline();
    vi.mocked(model.embed).mockResolvedValue(you);
    expect(await scanPairPhoto({ uri, prints, pipeline: model })).toEqual({ kind: 'unsure' });
  });

  it('accepts both recognized people in a group when an unrelated face cannot be aligned', async () => {
    const model = pipeline();
    vi.mocked(model.detect).mockResolvedValue([box(0), box(100), box(200)]);
    vi.mocked(model.embed).mockRejectedValueOnce(new Error('profile face has no landmarks')).mockResolvedValueOnce(you).mockResolvedValueOnce(partner);
    expect(await scanPairPhoto({ uri, prints, pipeline: model })).toEqual({ kind: 'pair', you: { faceIndex: 1, similarity: 1 }, partner: { faceIndex: 2, similarity: 1 } });
  });

  it('does not turn a missing target face embedding into a successful nonmatch', async () => {
    const model = pipeline();
    vi.mocked(model.embed).mockRejectedValueOnce(new Error('no landmarks')).mockResolvedValueOnce(you);
    expect(await scanPairPhoto({ uri, prints, pipeline: model })).toEqual({ kind: 'failed', stage: 'embedding' });
  });

  it('passes the threshold policy to the real matcher', async () => {
    const model = pipeline();
    vi.mocked(model.embed).mockResolvedValueOnce(you).mockResolvedValueOnce(new Float32Array([0, 0.8, 0.6]));
    expect(await scanPairPhoto({ uri, prints, pipeline: model, threshold: 0.81 })).toEqual({ kind: 'unsure' });
  });

  it.each(['availability', 'detection', 'embedding'] as const)('keeps %s failures distinct from a non-match without leaking the URI', async (stage) => {
    const model = pipeline();
    const error = new Error(`Native failure at ${uri}`);
    if (stage === 'availability') vi.mocked(model.isAvailable).mockRejectedValue(error);
    if (stage === 'detection') vi.mocked(model.detect).mockRejectedValue(error);
    if (stage === 'embedding') vi.mocked(model.embed).mockRejectedValue(error);
    expect(await scanPairPhoto({ uri, prints, pipeline: model })).toEqual({ kind: 'failed', stage });
  });

  it('honors cancellation before touching the model or photo', async () => {
    const model = pipeline();
    const controller = new AbortController();
    controller.abort();
    expect(await scanPairPhoto({ uri, prints, pipeline: model, signal: controller.signal })).toEqual({ kind: 'cancelled' });
    expect(model.isAvailable).not.toHaveBeenCalled();
  });

  it('stops after cancellation during availability or detection', async () => {
    for (const stage of ['availability', 'detection']) {
      const model = pipeline();
      const controller = new AbortController();
      if (stage === 'availability') vi.mocked(model.isAvailable).mockImplementation(async () => { controller.abort(); return true; });
      else vi.mocked(model.detect).mockImplementation(async () => { controller.abort(); return boxes; });
      expect(await scanPairPhoto({ uri, prints, pipeline: model, signal: controller.signal })).toEqual({ kind: 'cancelled' });
      expect(model.embed).not.toHaveBeenCalled();
      if (stage === 'availability') expect(model.detect).not.toHaveBeenCalled();
    }
  });

  it('embeds sequentially and stops between faces after cancellation', async () => {
    const model = pipeline();
    const controller = new AbortController();
    let finish: (embedding: Float32Array) => void = () => {};
    vi.mocked(model.embed).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = scanPairPhoto({ uri, prints, pipeline: model, signal: controller.signal });
    await vi.waitFor(() => expect(model.embed).toHaveBeenCalledOnce());
    controller.abort();
    finish(you);
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(model.embed).toHaveBeenCalledOnce();
  });

  it('treats an aborted native failure as cancelled', async () => {
    const model = pipeline();
    const controller = new AbortController();
    vi.mocked(model.detect).mockImplementation(async () => { controller.abort(); throw new Error(uri); });
    expect(await scanPairPhoto({ uri, prints, pipeline: model, signal: controller.signal })).toEqual({ kind: 'cancelled' });
  });

  it('rejects an invalid threshold before accessing a private photo', async () => {
    const model = pipeline();
    await expect(scanPairPhoto({ uri, prints, pipeline: model, threshold: NaN })).rejects.toThrow(RangeError);
    expect(model.isAvailable).not.toHaveBeenCalled();
  });
});
