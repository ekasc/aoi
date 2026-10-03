/**
 * Recognising which photos are the two of you.
 *
 * The identity pipeline still needs a dev build and a trained embedding
 * model. The separate local-face-detector uses Apple Vision for iOS still
 * photos, but boxes alone do not implement identity recognition.
 *
 * Why it is not free, stated once so it does not get forgotten: counting
 * faces is not recognising them. Two faces in a photo is your friends'
 * dinner, a work thing, a stranger on a train. Putting other people's faces
 * into a private album is a correctness problem, not a relevance one, and
 * the seam below is where the false-positive policy belongs.
 *
 * Everything about the pipeline is on device. There is no server-side
 * inference anywhere in this design, and the plugin name says so out loud
 * because a future contributor reading only the model file would otherwise
 * have no way to know.
 *
 * iOS uses Vision landmarks and the pinned SFace model. Android recognition
 * is unavailable; real-library accuracy and cutoff calibration remain open.
 */

export type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Head roll in degrees; null when the detector has no estimate. */
  rollAngle: number | null;
};

export type Faceprint = {
  /** The unit vector, on this device, forever. Never uploaded. */
  embedding: Float32Array;
  /** Whose it is. Fixed at enrolment, not inferred later. */
  person: 'you' | 'partner';
};

/**
 * What the pipeline is allowed to return.
 *
 * `unsure` is a real answer and the most important one in this file. The
 * pipeline's job is not to classify every face; it is to avoid putting a
 * stranger's photograph into the album of a relationship. Anything below
 * the threshold returns unsure and the photo is left alone, because a
 * missed photo costs nothing and a wrongly included one costs trust in
 * everything else the app claims.
 */
export type MatchResult =
  | { kind: 'match'; person: 'you' | 'partner'; confidence: number }
  | { kind: 'unsure'; confidence: number }
  | { kind: 'no-faces' };

export type FacePipeline<Face extends FaceBox = FaceBox> = {
  /** Is the underlying native model present at all? */
  isAvailable: () => Promise<boolean>;
  /** Find faces in a local file. */
  detect: (uri: string) => Promise<Face[]>;
  /** Turn a detected face into a faceprint. */
  embed: (uri: string, box: Face) => Promise<Float32Array>;
  /** Query-only augmentation must stay comparable with the saved reference embeddings. */
  embedQuery?: (uri: string, box: Face) => Promise<Float32Array>;
  /**
   * Compare against the two enrolled prints. Threshold is a policy
   * decision, not a modelling one, and it is deliberately not a constant
   * here: it belongs with the person who decides what a wrong answer costs.
   */
  match: (embedding: Float32Array, prints: Faceprint[], threshold: number) => MatchResult;
};

/** Cosine similarity, because a unit vector's angle is the meaningful part. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * The conservative default, and the reason it is called out: a threshold
 * that is too low fills the album with other people, and one that is too
 * high leaves it empty. Empty is the cheaper mistake, so this starts
 * high. It should be tuned against a real library on a real device, which
 * is the first thing to do after the first dev build.
 */
export const DEFAULT_MATCH_THRESHOLD = 0.72;
export const PAIR_MATCH_POLICY_VERSION = 'pair-v2';

export function matchByCosine(
  embedding: Float32Array,
  prints: Faceprint[],
  threshold: number = DEFAULT_MATCH_THRESHOLD,
): MatchResult {
  let best: { person: 'you' | 'partner'; score: number } | null = null;
  for (const print of prints) {
    const score = cosineSimilarity(embedding, print.embedding);
    if (!best || score > best.score) {
      best = { person: print.person, score };
    }
  }
  if (!best || best.score < threshold) {
    // Deliberately silent. Saying "this might be you" and being wrong is
    // the failure this whole feature is most likely to cause.
    return { kind: 'unsure', confidence: best?.score ?? 0 };
  }
  return { kind: 'match', person: best.person, confidence: best.score };
}

type MatchedFace = { faceIndex: number; similarity: number };
export type PairSimilarity = { you: number; partner: number };

export type PairMatchResult =
  | { kind: 'pair'; you: MatchedFace; partner: MatchedFace }
  | { kind: 'unsure' }
  | { kind: 'no-faces' };

/** Inputs are embeddings for distinct detected faces in one photo, never across photos. */
export function matchPairByCosine(
  faces: Float32Array[],
  prints: Faceprint[],
  threshold: number = DEFAULT_MATCH_THRESHOLD,
): PairMatchResult {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new RangeError('Face similarity threshold must be greater than zero and at most one');
  }
  if (faces.length === 0) return { kind: 'no-faces' };
  const youPrints = prints.filter((print) => print.person === 'you');
  const partnerPrints = prints.filter((print) => print.person === 'partner');
  if (youPrints.length === 0 || partnerPrints.length === 0) return { kind: 'unsure' };

  // Native model output is untrusted. Invalid vectors must not pass NaN comparisons.
  const dimensions = faces[0].length;
  const valid = (embedding: Float32Array) => embedding.length === dimensions
    && dimensions > 0 && embedding.every(Number.isFinite) && embedding.some((value) => value !== 0);
  if (!faces.every(valid) || !prints.every((print) => valid(print.embedding))) return { kind: 'unsure' };

  return matchPairByScores(faces.map((face) => ({
    you: Math.max(...youPrints.map((print) => cosineSimilarity(face, print.embedding))),
    partner: Math.max(...partnerPrints.map((print) => cosineSimilarity(face, print.embedding))),
  })), threshold);
}

/** Shared by runtime matching and offline evaluation of anonymized scores. */
export function matchPairByScores(scores: PairSimilarity[], threshold: number = DEFAULT_MATCH_THRESHOLD): PairMatchResult {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new RangeError('Face similarity threshold must be greater than zero and at most one');
  }
  if (scores.length === 0) return { kind: 'no-faces' };
  if (!scores.every((score) => Number.isFinite(score.you) && Number.isFinite(score.partner))) return { kind: 'unsure' };
  let you: MatchedFace | null = null;
  let partner: MatchedFace | null = null;
  scores.forEach(({ you: youScore, partner: partnerScore }, faceIndex) => {
    // A face that qualifies as both people cannot establish either identity.
    if (youScore >= threshold && partnerScore < threshold && (!you || youScore > you.similarity)) {
      you = { faceIndex, similarity: youScore };
    }
    if (partnerScore >= threshold && youScore < threshold && (!partner || partnerScore > partner.similarity)) {
      partner = { faceIndex, similarity: partnerScore };
    }
  });
  return you && partner ? { kind: 'pair', you, partner } : { kind: 'unsure' };
}
