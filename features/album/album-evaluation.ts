import { cosineSimilarity, DEFAULT_MATCH_THRESHOLD, matchPairByScores, PAIR_MATCH_POLICY_VERSION, type FacePipeline, type Faceprint, type PairSimilarity } from '@/features/album/face-pipeline';
import type { DetectedPhotoFace } from '@/features/album/photo-face-detector';

export type EvaluationSplit = 'calibration' | 'validation';
export type EvaluationLabel = 'both' | 'one' | 'neither';
export type EvaluationOptions = { split: EvaluationSplit; label: EvaluationLabel; group: string };
export type EvaluationSample = { split: EvaluationSplit; group: string; bothPresent: boolean; faces: PairSimilarity[] };
export type EvaluationPhoto = {
  scores: PairSimilarity[];
  detected: number;
  processingFailures: number;
  previews: { face: number; uri: string | null; error: string | null }[];
};
export type EvaluationState = { samples: EvaluationSample[]; processingFailures: number; lastPhoto: EvaluationPhoto | null };
export const EMPTY_EVALUATION: EvaluationState = { samples: [], processingFailures: 0, lastPhoto: null };

export function evaluationGroupError(samples: EvaluationSample[], options: EvaluationOptions): string | null {
  if (!/^[a-z0-9-]{1,48}$/.test(options.group)) return 'Use an anonymous session label with lowercase letters, numbers or hyphens.';
  if (samples.some((sample) => sample.group === options.group && sample.split !== options.split)) return 'Keep each session in one split. Use a different capture session for validation.';
  return null;
}

export async function evaluateSelectedPhoto({ engine, uri, prints, signal, preview }: {
  engine: FacePipeline<DetectedPhotoFace>; uri: string; prints: Faceprint[]; signal: AbortSignal;
  preview: (uri: string, face: DetectedPhotoFace) => Promise<string>;
}): Promise<EvaluationPhoto | null> {
  if (signal.aborted) return null;
  if (!await engine.isAvailable()) throw new Error('Recognition is unavailable.');
  if (signal.aborted) return null;
  const faces = await engine.detect(uri);
  const report: EvaluationPhoto = { detected: faces.length, processingFailures: 0, scores: [], previews: [] };
  for (const [index, face] of faces.entries()) {
    if (signal.aborted) return null;
    let crop: string | null = null;
    let error: string | null = null;
    if (index < 8) {
      try { crop = await preview(uri, face); }
      catch { error = 'Aligned crop unavailable. Check landmarks or the installed dev build.'; }
      report.previews.push({ face: index + 1, uri: crop, error });
    }
    if (signal.aborted) return null;
    let embedding: Float32Array;
    try { embedding = await engine.embed(uri, face); }
    catch { report.processingFailures++; continue; }
    try {
      if (signal.aborted) return null;
      const you = Math.max(...prints.filter((print) => print.person === 'you').map((print) => cosineSimilarity(embedding, print.embedding)));
      const partner = Math.max(...prints.filter((print) => print.person === 'partner').map((print) => cosineSimilarity(embedding, print.embedding)));
      if (!Number.isFinite(you) || !Number.isFinite(partner)) { report.processingFailures++; continue; }
      report.scores.push({ you: Math.max(-1, Math.min(1, you)), partner: Math.max(-1, Math.min(1, partner)) });
    } finally { embedding.fill(0); }
  }
  return signal.aborted ? null : report;
}

export function evaluationMetrics(samples: EvaluationSample[], split: EvaluationSplit) {
  let hits = 0, misses = 0, falseAdds = 0, correctRejects = 0;
  for (const sample of samples.filter((item) => item.split === split)) {
    const pair = matchPairByScores(sample.faces).kind === 'pair';
    if (sample.bothPresent) { if (pair) hits++; else misses++; }
    else if (pair) falseAdds++; else correctRejects++;
  }
  return { hits, misses, falseAdds, correctRejects };
}

export function exportEvaluation(state: EvaluationState, modelId: string): string {
  const groups = new Map<string, string>();
  const anonymousGroup = (group: string) => {
    const existing = groups.get(group);
    if (existing) return existing;
    const value = `group-${groups.size + 1}`; groups.set(group, value); return value;
  };
  return JSON.stringify({ version: 1, modelId, policyVersion: PAIR_MATCH_POLICY_VERSION, currentThreshold: DEFAULT_MATCH_THRESHOLD,
    processingFailures: state.processingFailures,
    samples: state.samples.map(({ split, group, bothPresent, faces }) => ({ split, group: anonymousGroup(group), bothPresent, faces: faces.map(({ you, partner }) => ({ you, partner })) })) }, null, 2);
}
