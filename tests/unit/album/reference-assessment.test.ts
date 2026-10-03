import { describe, expect, it } from 'vitest';

import { assessReferencePhoto, parseReferencePreviews } from '@/features/album/reference-assessment';
import { SFACE_TEMPLATE } from '@/features/album/face-alignment';

const face = { x: 0, y: 0, width: 200, height: 200, rollAngle: 0, landmarks: SFACE_TEMPLATE };
describe('reference-photo assessment', () => {
  it('rejects missing faces, group references, and unusable alignment', () => {
    for (const faces of [[], [face, face], [{ ...face, landmarks: null }]]) {
      expect(assessReferencePhoto({ width: 400, height: 400, faces }).grade).toBe('rejected');
    }
  });
  it('explains a small tilted face without pretending it measures identity confidence', () => {
    const assessment = assessReferencePhoto({ width: 400, height: 400, faces: [{ ...face, width: 80, rollAngle: 25 }] });
    expect(assessment).toMatchObject({ grade: 'improve', captureQuality: null });
    expect(assessment.notes.join(' ')).toMatch(/small.*tilted/);
  });
  it('preserves Apple capture quality as a separate score, without inventing one when absent', () => {
    expect(assessReferencePhoto({ width: 400, height: 400, faces: [face] })).toMatchObject({ grade: 'usable', captureQuality: null });
    expect(assessReferencePhoto({ width: 400, height: 400, faces: [{ ...face, captureQuality: 0.8 }] })).toMatchObject({ grade: 'usable', captureQuality: 0.8 });
  });
  it('rejects persisted paths and invalid scores before reconstructing local thumbnails', () => {
    for (const item of [{ id: '../../private', assessment: { grade: 'usable', notes: [], captureQuality: 0.8 } }, { id: 'safe', assessment: { grade: 'usable', notes: [], captureQuality: 100 } }]) {
      expect(() => parseReferencePreviews(JSON.stringify([item]))).toThrow();
    }
  });
});
