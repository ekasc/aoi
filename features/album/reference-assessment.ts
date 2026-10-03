import type { DetectedPhotoFaces } from '@/features/album/photo-face-detector';

export type ReferenceAssessment = {
  grade: 'usable' | 'improve' | 'rejected'; notes: string[]; captureQuality: number | null;
};
export type ReferencePreview = { id: string; uri: string | null; assessment: ReferenceAssessment };
export type ReferencePreviews = { you: ReferencePreview | null; partner: ReferencePreview | null };

export function assessReferencePhoto(photo: DetectedPhotoFaces): ReferenceAssessment {
  if (photo.faces.length !== 1) return { grade: 'rejected', notes: [photo.faces.length ? 'Choose a solo photo. More than one face was found.' : 'No face found. Choose a clearer, front-facing photo.'], captureQuality: null };
  const face = photo.faces[0];
  const notes: string[] = [];
  if (!face.landmarks) return { grade: 'rejected', notes: ['Eyes, nose, and mouth could not be aligned. Choose a clearer photo.'], captureQuality: face.captureQuality ?? null };
  if (Math.min(face.width, face.height) < 120) notes.push('The face is small. A closer portrait is a better reference.');
  if (face.rollAngle !== null && Math.abs(face.rollAngle) > 15) notes.push('The head is tilted. A straight-on portrait is a better reference.');
  return { grade: notes.length ? 'improve' : 'usable', notes: notes.length ? notes : ['One face found with usable eyes, nose, and mouth landmarks.'], captureQuality: face.captureQuality ?? null };
}

export function parseReferencePreviews(raw: string | null): Omit<ReferencePreview, 'uri'>[] {
  if (!raw) return [];
  const items: unknown = JSON.parse(raw);
  if (!Array.isArray(items) || items.length > 2) throw new Error('Invalid reference previews');
  return items.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(item.id)
      || !('assessment' in item) || !item.assessment || typeof item.assessment !== 'object') throw new Error('Invalid reference preview');
    const assessment = item.assessment;
    if (!('grade' in assessment) || (assessment.grade !== 'usable' && assessment.grade !== 'improve' && assessment.grade !== 'rejected')
      || !('notes' in assessment) || !Array.isArray(assessment.notes) || !assessment.notes.every((note: unknown) => typeof note === 'string')
      || !('captureQuality' in assessment) || (assessment.captureQuality !== null && (typeof assessment.captureQuality !== 'number' || !Number.isFinite(assessment.captureQuality) || assessment.captureQuality < 0 || assessment.captureQuality > 1))) throw new Error('Invalid reference assessment');
    return { id: item.id, assessment: { grade: assessment.grade, notes: assessment.notes, captureQuality: assessment.captureQuality } };
  });
}
