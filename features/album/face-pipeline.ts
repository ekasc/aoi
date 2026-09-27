/**
 * Recognising which photos are the two of you.
 *
 * This is the part that needs a dev build and a trained model, and it is
 * written as a seam rather than an implementation so the decision about the
 * model can be made deliberately instead of inherited.
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
 * The tools that exist, verified rather than assumed:
 *
 *   react-native-vision-camera   active, boxes and landmarks. No identity.
 *   react-native-fast-tflite     active, runs a TFLite model on device via
 *                                NNAPI on Android and CoreML on iOS.
 *   expo-face-detector          ARCHIVED 2018, deprecated. Not an option.
 *
 * So detection comes from VisionCamera and identity from a TFLite embedding
 * model — ArcFace or MobileFaceNet, both open, both convertible — compared
 * against two stored faceprints on this device.
 */

export type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** How turned the head is, in degrees. A high angle is a bad embedding. */
  rollAngle: number;
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

export type FacePipeline = {
  /** Is the underlying native model present at all? */
  isAvailable: () => Promise<boolean>;
  /** Find faces in a local file. */
  detect: (uri: string) => Promise<FaceBox[]>;
  /** Turn a detected face into a faceprint. */
  embed: (uri: string, box: FaceBox) => Promise<Float32Array>;
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
