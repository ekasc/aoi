import { cosineSimilarity, DEFAULT_MATCH_THRESHOLD, PAIR_MATCH_POLICY_VERSION, type Faceprint, type PairSimilarity } from '@/features/album/face-pipeline';
import { scanPairPhoto } from '@/features/album/scan-pair-photo';
import type { createFaceRecognitionEngine } from '@/features/album/face-recognition-engine';

type Engine = ReturnType<typeof createFaceRecognitionEngine>;
export type TestPhoto = { id: string; uri: string; bothPresent: boolean };
export type PhotoResult = { id: string; bothPresent: boolean; detected: number | null; scores: PairSimilarity[]; outcome: 'found' | 'missed' | 'incorrect-match' | 'rejected' | 'failed'; reason: string };

export async function enrollTestReferences(engine: Engine, uris: { you: string; partner: string }): Promise<Faceprint[]> {
  const prints: Faceprint[] = [];
  try {
    for (const person of ['you', 'partner'] as const) {
      const faces = await engine.detect(uris[person]);
      if (faces.length !== 1 || !faces[0].landmarks) throw new Error(`The ${person === 'you' ? 'first' : 'second'} reference needs one clear face. Choose another reference photo.`);
      prints.push({ person, embedding: await engine.embed(uris[person], faces[0]) });
    }
    if (cosineSimilarity(prints[0].embedding, prints[1].embedding) >= DEFAULT_MATCH_THRESHOLD) throw new Error('Use references of two different people. These references are too similar.');
    return prints;
  } catch (error) {
    for (const print of prints) print.embedding.fill(0);
    throw error;
  }
}

export async function testLabeledPhoto(engine: Engine, prints: Faceprint[], photo: TestPhoto, threshold = DEFAULT_MATCH_THRESHOLD): Promise<PhotoResult> {
  const row: PhotoResult = { id: photo.id, bothPresent: photo.bothPresent, detected: null, scores: [], outcome: 'failed', reason: 'Could not process photo' };
  const temporary: Float32Array[] = [];
  try {
    const result = await scanPairPhoto({ uri: photo.uri, prints, threshold, pipeline: {
      ...engine,
      detect: async (uri) => { const faces = await engine.detect(uri); row.detected = faces.length; return faces; },
      embedQuery: async (uri, face) => {
        const embedding = await (engine.embedQuery ?? engine.embed)(uri, face); temporary.push(embedding);
        row.scores.push({ you: Math.max(...prints.filter((print) => print.person === 'you').map((print) => cosineSimilarity(embedding, print.embedding))),
          partner: Math.max(...prints.filter((print) => print.person === 'partner').map((print) => cosineSimilarity(embedding, print.embedding))) });
        return embedding;
      },
    } });
    if (result.kind === 'failed' || result.kind === 'unavailable' || result.kind === 'enrollment-required' || result.kind === 'cancelled') {
      row.reason = result.kind === 'failed' ? `${result.stage} failed` : result.kind;
      return row;
    }
    row.outcome = result.kind === 'pair' ? photo.bothPresent ? 'found' : 'incorrect-match' : photo.bothPresent ? 'missed' : 'rejected';
    row.reason = result.kind === 'pair' ? 'Both references matched distinct faces' : result.kind === 'single-face' ? 'Only one face detected' : result.kind === 'no-faces' ? 'No faces detected' : 'No confident pair match';
    return row;
  } finally { temporary.forEach((embedding) => embedding.fill(0)); }
}

export function summarizeTest(rows: PhotoResult[], threshold = DEFAULT_MATCH_THRESHOLD) {
  const count = (outcome: PhotoResult['outcome']) => rows.filter((row) => row.outcome === outcome).length;
  const found = count('found'), missed = count('missed'), incorrectMatches = count('incorrect-match'), rejected = count('rejected'), failed = count('failed');
  return { found, missed, incorrectMatches, rejected, failed,
    positiveChecks: found + missed, negativeChecks: incorrectMatches + rejected,
    recall: found + missed ? found / (found + missed) : null,
    falsePositiveRate: incorrectMatches + rejected ? incorrectMatches / (incorrectMatches + rejected) : null,
    threshold, policyVersion: PAIR_MATCH_POLICY_VERSION, readyForProduction: false };
}
