import {
  DEFAULT_MATCH_THRESHOLD,
  matchPairByCosine,
  type FacePipeline,
  type FaceBox,
  type Faceprint,
  type PairMatchResult,
} from '@/features/album/face-pipeline';

export type PairScanResult = PairMatchResult
  | { kind: 'single-face' }
  | { kind: 'enrollment-required' }
  | { kind: 'unavailable' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; stage: 'availability' | 'detection' | 'embedding' };

/** Scans only the supplied local photo. It never imports, persists, or shares it. */
export async function scanPairPhoto<Face extends FaceBox>({ uri, prints, pipeline, threshold = DEFAULT_MATCH_THRESHOLD, signal }: {
  uri: string;
  prints: Faceprint[];
  pipeline: FacePipeline<Face>;
  threshold?: number;
  signal?: AbortSignal;
}): Promise<PairScanResult> {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new RangeError('Face similarity threshold must be greater than zero and at most one');
  }
  if (signal?.aborted) return { kind: 'cancelled' };
  if (!prints.some((print) => print.person === 'you') || !prints.some((print) => print.person === 'partner')) {
    return { kind: 'enrollment-required' };
  }

  let stage: 'availability' | 'detection' | 'embedding' = 'availability';
  const embeddings: Float32Array[] = [];
  const indices: number[] = [];
  let embeddingFailed = false;
  try {
    const available = await pipeline.isAvailable();
    if (signal?.aborted) return { kind: 'cancelled' };
    if (!available) return { kind: 'unavailable' };
    stage = 'detection';
    const faces = await pipeline.detect(uri);
    if (signal?.aborted) return { kind: 'cancelled' };
    if (faces.length === 1) return { kind: 'single-face' };
    stage = 'embedding';
    // One embedding at a time bounds model work and permits cancellation between faces.
    for (const [index, face] of faces.entries()) {
      let embedding: Float32Array;
      try { embedding = await (pipeline.embedQuery ?? pipeline.embed)(uri, face); }
      catch {
        if (signal?.aborted) return { kind: 'cancelled' };
        embeddingFailed = true;
        continue;
      }
      if (signal?.aborted) return { kind: 'cancelled' };
      embeddings.push(embedding);
      indices.push(index);
    }
  } catch {
    return signal?.aborted ? { kind: 'cancelled' } : { kind: 'failed', stage };
  }
  const result = matchPairByCosine(embeddings, prints, threshold);
  if (result.kind === 'pair') {
    return { ...result, you: { ...result.you, faceIndex: indices[result.you.faceIndex] }, partner: { ...result.partner, faceIndex: indices[result.partner.faceIndex] } };
  }
  return embeddingFailed ? { kind: 'failed', stage: 'embedding' } : result;
}
