import { describe, expect, it, vi } from 'vitest';

import { SFACE_TEMPLATE } from '@/features/album/face-alignment';
import { createFaceRecognitionEngine, flipAlignedFacePixels, fuseFaceEmbeddings, normalizeFaceEmbedding, parseFacePixels, type RecognitionDependencies } from '@/features/album/face-recognition-engine';
import { scanPairPhoto } from '@/features/album/scan-pair-photo';

const face = { x: 0, y: 0, width: 112, height: 112, rollAngle: 0, landmarks: SFACE_TEMPLATE };
const pixels = () => Array.from({ length: 3 * 112 * 112 }, () => 128);
const embedding = (index = 0) => { const value = new Float32Array(128); value[index] = 2; return value; };
function fixture() {
  const session = { embed: vi.fn(async () => embedding()), release: vi.fn(async () => {}) };
  const dependencies: RecognitionDependencies = {
    detect: vi.fn(async () => ({ width: 112, height: 112, faces: [face] })),
    prepare: vi.fn(async () => pixels()),
    loadSession: vi.fn(async () => session),
  };
  return { engine: createFaceRecognitionEngine(dependencies), dependencies, session };
}

describe('local face recognition engine', () => {
  it('does not pretend unsupported platforms can recognize faces', async () => {
    const engine = createFaceRecognitionEngine(null);
    expect(await engine.isAvailable()).toBe(false);
    await expect(engine.embed('file:///photo', face)).rejects.toThrow('unavailable');
    await engine.dispose();
  });

  it('loads once, aligns using the reference, and returns a normalized embedding', async () => {
    const { engine, dependencies, session } = fixture();
    try {
      expect(await engine.isAvailable()).toBe(true);
      const result = await engine.embed('file:///photo', face);
      expect(result[0]).toBe(1);
      expect(Math.hypot(...result)).toBe(1);
      expect(dependencies.prepare).toHaveBeenCalledWith('file:///photo', { a: 1, b: 0, tx: 0, ty: 0 });
      expect(session.embed.mock.calls[0][0]).toBeInstanceOf(Float32Array);
      expect(dependencies.loadSession).toHaveBeenCalledOnce();
      expect(engine.modelId).toContain('sface-2021dec');
      expect(engine.modelId).toContain('vision-contours-v1');
    } finally { await engine.dispose(); }
    expect(session.release).toHaveBeenCalledOnce();
  });

  it('does not run inference for a face without landmarks', async () => {
    const { engine, dependencies, session } = fixture();
    try {
      await expect(engine.embed('file:///photo', { ...face, landmarks: null })).rejects.toThrow('landmarks');
      expect(dependencies.prepare).not.toHaveBeenCalled();
      expect(session.embed).not.toHaveBeenCalled();
    } finally { await engine.dispose(); }
  });

  it('retries model loading after a failure without caching a rejected session', async () => {
    const { engine, dependencies } = fixture();
    vi.mocked(dependencies.loadSession).mockRejectedValueOnce(new Error('not ready'));
    try {
      await expect(engine.isAvailable()).rejects.toThrow('not ready');
      expect(await engine.isAvailable()).toBe(true);
      expect(dependencies.loadSession).toHaveBeenCalledTimes(2);
    } finally { await engine.dispose(); }
  });

  it('serializes requests so model inference cannot overlap', async () => {
    const { engine, session } = fixture();
    let finish: (value: Float32Array) => void = () => {};
    session.embed.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const first = engine.embed('file:///one', face);
    const second = engine.embed('file:///two', face);
    await vi.waitFor(() => expect(session.embed).toHaveBeenCalledOnce());
    finish(embedding());
    await Promise.all([first, second]);
    expect(session.embed).toHaveBeenCalledTimes(2);
    await engine.dispose();
  });

  it('waits for active work to stop before releasing a session and discards its result', async () => {
    const { engine, session } = fixture();
    let finish: (value: Float32Array) => void = () => {};
    session.embed.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = engine.embed('file:///one', face);
    const rejected = expect(pending).rejects.toThrow('closed');
    await vi.waitFor(() => expect(session.embed).toHaveBeenCalledOnce());
    const disposal = engine.dispose();
    expect(session.release).not.toHaveBeenCalled();
    finish(embedding());
    await rejected;
    await disposal;
    await engine.dispose();
    expect(session.release).toHaveBeenCalledOnce();
    await expect(engine.detect('file:///another')).rejects.toThrow('closed');
  });

  it('does not run queued inference after disposal begins', async () => {
    const { engine, dependencies } = fixture();
    const pending = engine.embed('file:///one', face);
    const rejected = expect(pending).rejects.toThrow('closed');
    await engine.dispose();
    await rejected;
    expect(dependencies.prepare).not.toHaveBeenCalled();
  });

  it('runs detection and embeddings through the pair scanner without storing or sharing photos', async () => {
    const { engine, dependencies, session } = fixture();
    vi.mocked(dependencies.detect).mockResolvedValue({ width: 112, height: 112, faces: [face, { ...face, x: 112 }] });
    session.embed.mockResolvedValueOnce(embedding(0)).mockResolvedValueOnce(embedding(1));
    try {
      expect(await scanPairPhoto({ uri: 'file:///pair', prints: [{ person: 'you', embedding: embedding(0) }, { person: 'partner', embedding: embedding(1) }], pipeline: engine })).toMatchObject({ kind: 'pair', you: { faceIndex: 0 }, partner: { faceIndex: 1 } });
    } finally { await engine.dispose(); }
  });

  it('keeps missing alignment distinct from a successful non-match', async () => {
    const { engine, dependencies } = fixture();
    vi.mocked(dependencies.detect).mockResolvedValue({ width: 112, height: 112, faces: [{ ...face, landmarks: null }, { ...face, x: 112, landmarks: null }] });
    try {
      expect(await scanPairPhoto({ uri: 'file:///photo', prints: [{ person: 'you', embedding: embedding(0) }, { person: 'partner', embedding: embedding(1) }], pipeline: engine })).toEqual({ kind: 'failed', stage: 'embedding' });
    } finally { await engine.dispose(); }
  });
});

describe('model data boundaries', () => {
  it('mirrors each CHW channel without reversing rows or mutating the source', () => {
    const source = Float32Array.from({ length: 3 * 112 * 112 }, (_, index) => index);
    const mirrored = flipAlignedFacePixels(source);
    for (const channel of [0, 1, 2]) {
      const start = channel * 112 * 112;
      expect(mirrored[start]).toBe(source[start + 111]);
      expect(mirrored[start + 112]).toBe(source[start + 223]);
    }
    expect(flipAlignedFacePixels(mirrored)).toEqual(source);
    expect(source[0]).toBe(0);
    expect(() => flipAlignedFacePixels(new Float32Array(1))).toThrow();
  });

  it('sums raw model outputs before normalization, as upstream flip fusion does', () => {
    const a = embedding(0), b = embedding(1); b[1] = 4;
    const fused = fuseFaceEmbeddings(a, b);
    expect(fused[0]).toBeCloseTo(2 / Math.sqrt(20));
    expect(fused[1]).toBeCloseTo(4 / Math.sqrt(20));
    expect(a[0]).toBe(2);
    expect(b[1]).toBe(4);
    expect(() => fuseFaceEmbeddings(a, new Float32Array(127))).toThrow();
    expect(() => fuseFaceEmbeddings(a, Float32Array.from(a, (value) => -value))).toThrow();
  });

  it('keeps reference embeddings unchanged and makes query fusion opt-in', async () => {
    const session = { embed: vi.fn(async (_input: Float32Array) => embedding()), release: vi.fn(async () => {}) };
    const dependencies = { detect: vi.fn(async () => ({ width: 112, height: 112, faces: [face] })), prepare: vi.fn(async () => pixels()), loadSession: vi.fn(async () => session) };
    const engine = createFaceRecognitionEngine(dependencies, { queryFlipFusion: true });
    try {
      await engine.embed('file:///reference', face);
      expect(session.embed).toHaveBeenCalledTimes(1);
      await engine.embedQuery?.('file:///query', face);
      expect(session.embed).toHaveBeenCalledTimes(3);
      expect(session.embed.mock.calls.every(([input]) => input.every((value) => value === 0))).toBe(true);
    } finally { await engine.dispose(); }
    const baseline = fixture();
    try {
      await baseline.engine.embedQuery?.('file:///query', face);
      expect(baseline.session.embed).toHaveBeenCalledTimes(1);
    } finally { await baseline.engine.dispose(); }
  });

  it('clears original and flipped pixels and outputs when second inference fails', async () => {
    const raw = embedding();
    const session = { embed: vi.fn(async (_input: Float32Array) => raw).mockResolvedValueOnce(raw).mockRejectedValueOnce(new Error('failed')), release: vi.fn(async () => {}) };
    const engine = createFaceRecognitionEngine({ detect: async () => ({ width: 112, height: 112, faces: [face] }), prepare: async () => pixels(), loadSession: async () => session }, { queryFlipFusion: true });
    try {
      await expect(engine.embedQuery?.('file:///query', face)).rejects.toThrow('failed');
      expect(raw.every((value) => value === 0)).toBe(true);
      expect(session.embed.mock.calls.every(([input]) => input.every((value) => value === 0))).toBe(true);
    } finally { await engine.dispose(); }
  });

  it('rejects malformed, nonfinite, or non-RGB-range inputs', () => {
    expect(parseFacePixels(pixels())).toHaveLength(3 * 112 * 112);
    expect(() => parseFacePixels([])).toThrow();
    for (const value of [NaN, Infinity, -1, 256, '128']) {
      const data: unknown[] = pixels(); data[0] = value;
      expect(() => parseFacePixels(data)).toThrow();
    }
  });

  it('requires a finite, nonzero, 128-dimensional model output', () => {
    for (const value of [new Float32Array(0), new Float32Array(127), new Float32Array(128), new Float32Array(128).fill(NaN), new Float32Array(128).fill(Infinity), Array.from(embedding())]) {
      expect(() => normalizeFaceEmbedding(value)).toThrow();
    }
    const raw = embedding();
    expect(normalizeFaceEmbedding(raw)[0]).toBe(1);
    expect(raw[0]).toBe(2);
  });
});
