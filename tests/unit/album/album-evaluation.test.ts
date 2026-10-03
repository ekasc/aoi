import { describe, expect, it, vi } from 'vitest';

import { alignedFaceRgba } from '@/features/album/aligned-face-pixels';
import { EMPTY_EVALUATION, evaluateSelectedPhoto, evaluationGroupError, evaluationMetrics, exportEvaluation } from '@/features/album/album-evaluation';
import { SFACE_SIZE, SFACE_TEMPLATE } from '@/features/album/face-alignment';
import type { FacePipeline } from '@/features/album/face-pipeline';
import type { DetectedPhotoFace } from '@/features/album/photo-face-detector';

const prints = [{ person: 'you' as const, embedding: new Float32Array([1, 0, 0]) }, { person: 'partner' as const, embedding: new Float32Array([0, 1, 0]) }];
function fixture() {
  const engine = {
    isAvailable: vi.fn(async () => true),
    detect: vi.fn(async (): Promise<DetectedPhotoFace[]> => [0, 1].map((x) => ({ x, y: 0, width: 100, height: 100, rollAngle: 0, landmarks: SFACE_TEMPLATE }))),
    embed: vi.fn(async (_uri: string, face: DetectedPhotoFace) => new Float32Array(face.x === 0 ? [1, 0, 0] : [0, 1, 0])),
    match: vi.fn(),
  } satisfies FacePipeline<DetectedPhotoFace>;
  return { engine, preview: vi.fn(async () => 'data:image/png;base64,preview'), signal: new AbortController().signal, uri: 'file:///private-selection', prints };
}

describe('local evaluation and exact aligned pixels', () => {
  it('preserves planar RGB order and opaque alpha when displaying model input', () => {
    const plane = SFACE_SIZE ** 2;
    const pixels = new Float32Array(plane * 3);
    pixels[0] = 17; pixels[plane] = 83; pixels[plane * 2] = 241;
    pixels[1] = 12; pixels[plane + 1] = 64; pixels[plane * 2 + 1] = 128;
    expect([...alignedFaceRgba(pixels).slice(0, 8)]).toEqual([17, 83, 241, 255, 12, 64, 128, 255]);
    pixels[0] = NaN;
    expect(() => alignedFaceRgba(pixels)).toThrow('Invalid aligned face pixels');
  });

  it('returns local crops and numerical scores, and wipes temporary embeddings', async () => {
    const input = fixture();
    const temporary: Float32Array[] = [];
    input.engine.embed.mockImplementation(async (_uri, face) => {
      const embedding = new Float32Array(face.x === 0 ? [1, 0, 0] : [0, 1, 0]); temporary.push(embedding); return embedding;
    });
    const report = await evaluateSelectedPhoto(input);
    expect(report).toMatchObject({ detected: 2, processingFailures: 0, scores: [{ you: 1, partner: 0 }, { you: 0, partner: 1 }] });
    expect(input.preview).toHaveBeenCalledTimes(2);
    expect(temporary.every((embedding) => embedding.every((value) => value === 0))).toBe(true);
    const exported = exportEvaluation({ samples: [{ split: 'calibration', group: 'private-session-label', bothPresent: true, faces: report?.scores ?? [] }], processingFailures: 0, lastPhoto: report }, 'model-test');
    expect(exported).not.toContain('private-selection');
    expect(exported).not.toContain('data:image');
    expect(exported).not.toContain('embedding');
    expect(exported).not.toContain('private-session-label');
    expect(JSON.parse(exported).samples[0].faces).toEqual([{ you: 1, partner: 0 }, { you: 0, partner: 1 }]);
  });

  it('keeps crop failure separate from embedding failure and permits cancellation between native operations', async () => {
    const input = fixture();
    input.preview.mockRejectedValue(new Error('private native path'));
    input.engine.embed.mockRejectedValueOnce(new Error('private model error'));
    expect(await evaluateSelectedPhoto(input)).toMatchObject({ detected: 2, processingFailures: 1, previews: [{ uri: null }, { uri: null }] });
    const abort = new AbortController();
    input.preview.mockImplementation(async () => { abort.abort(); return 'crop'; });
    input.engine.embed.mockClear();
    expect(await evaluateSelectedPhoto({ ...input, signal: abort.signal })).toBeNull();
    expect(input.engine.embed).not.toHaveBeenCalled();
  });

  it('blocks capture-session leakage and reports false additions separately from missed positives', () => {
    const samples = [
      { split: 'calibration' as const, group: 'session-1', bothPresent: true, faces: [{ you: 0.5, partner: 0.1 }, { you: 0.1, partner: 0.5 }] },
      { split: 'validation' as const, group: 'session-2', bothPresent: false, faces: [{ you: 0.8, partner: 0.1 }, { you: 0.1, partner: 0.8 }] },
    ];
    expect(evaluationGroupError(samples, { split: 'validation', group: 'session-1', label: 'both' })).toMatch(/one split/);
    expect(evaluationGroupError(samples, { split: 'validation', group: 'session-3', label: 'both' })).toBeNull();
    expect(evaluationMetrics(samples, 'calibration')).toEqual({ hits: 0, misses: 1, falseAdds: 0, correctRejects: 0 });
    expect(evaluationMetrics(samples, 'validation')).toEqual({ hits: 0, misses: 0, falseAdds: 1, correctRejects: 0 });
    expect(JSON.parse(exportEvaluation(EMPTY_EVALUATION, 'model-test')).samples).toEqual([]);
  });
});
