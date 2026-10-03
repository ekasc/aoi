import { describe, expect, it, vi } from 'vitest';

import { diagnosePhotoFaces } from '@/features/album/diagnose-photo-faces';
import type { FacePipeline } from '@/features/album/face-pipeline';
import type { DetectedPhotoFace } from '@/features/album/photo-face-detector';

function fixture() {
  const engine = {
    isAvailable: vi.fn(async () => true),
    detect: vi.fn(async (): Promise<DetectedPhotoFace[]> => []),
    embed: vi.fn(), match: vi.fn(),
  } satisfies FacePipeline<DetectedPhotoFace>;
  return engine;
}

describe('photo face diagnostics', () => {
  it('reports face geometry and missing landmarks without computing embeddings or matching identities', async () => {
    const engine = fixture();
    engine.detect.mockResolvedValue([{ x: 0, y: 0, width: 120, height: 140, rollAngle: 5, landmarks: null }]);
    const report = await diagnosePhotoFaces(engine, 'file:///selected.jpg', new AbortController().signal);
    expect(report).toEqual({ kind: 'analyzed', detected: 1, faces: [{ face: 1, width: 120, height: 140, rollAngle: 5, alignmentUsable: false }] });
    expect(engine.embed).not.toHaveBeenCalled();
    expect(engine.match).not.toHaveBeenCalled();
  });

  it('distinguishes no faces from a failed detector without exposing native paths', async () => {
    const engine = fixture();
    expect(await diagnosePhotoFaces(engine, 'file:///selected.jpg', new AbortController().signal)).toEqual({ kind: 'analyzed', detected: 0, faces: [] });
    engine.detect.mockRejectedValue(new Error('Private local path'));
    expect(await diagnosePhotoFaces(engine, 'file:///selected.jpg', new AbortController().signal)).toEqual({ kind: 'failed', stage: 'detection' });
  });

  it('stops after cancellation during detection', async () => {
    const engine = fixture();
    const abort = new AbortController();
    engine.detect.mockImplementation(async () => { abort.abort(); return []; });
    expect(await diagnosePhotoFaces(engine, 'file:///selected.jpg', abort.signal)).toEqual({ kind: 'cancelled' });
    expect(engine.embed).not.toHaveBeenCalled();
  });
});
