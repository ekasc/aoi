import type { DetectedPhotoFaces } from '@/features/album/photo-face-detector';
import type { ReferenceAssessment, ReferencePreview, ReferencePreviews } from '@/features/album/reference-assessment';

export async function inspectFaceReference(_uri: string): Promise<DetectedPhotoFaces> { throw new Error('Reference assessment requires the iPhone dev build.'); }
export function referencePhotoStore(_scopeKey: string) {
  return {
    create: async (_uri: string, _photo: DetectedPhotoFaces, _assessment: ReferenceAssessment): Promise<ReferencePreview> => { throw new Error('Reference previews require the iPhone dev build.'); },
    load: async (_referenceId?: string): Promise<ReferencePreviews> => ({ you: null, partner: null }),
    save: async (_previews: ReferencePreviews, _referenceId: string) => {}, discard: (_preview: ReferencePreview | null) => {}, clear: async () => {},
  };
}
