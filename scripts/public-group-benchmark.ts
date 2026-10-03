import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_MATCH_THRESHOLD, cosineSimilarity, type Faceprint } from '@/features/album/face-pipeline';
import type { createFaceRecognitionEngine } from '@/features/album/face-recognition-engine';

import { summarizeTest, testLabeledPhoto } from './face-test-core';

type Source = { file: string; sha256: string; role: 'reference' | 'extra-reference' | 'both' | 'not-both' };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function parseGroupSources(value: unknown): Source[] {
  if (!object(value) || !Array.isArray(value.images)) throw new Error('Invalid public group sources');
  const images = value.images.map((item): Source => {
    if (!object(item) || typeof item.file !== 'string' || !/^(?:(?:extra-)?(?:you|partner)\.jpg|(?:both|not-both)\/[a-z0-9-]+\.jpg)$/.test(item.file)
      || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)
      || !['reference', 'extra-reference', 'both', 'not-both'].includes(String(item.role))) throw new Error('Invalid public group source');
    const role = item.role;
    if (role !== 'reference' && role !== 'extra-reference' && role !== 'both' && role !== 'not-both') throw new Error('Invalid group role');
    if (role === 'reference' ? !/^(you|partner)\.jpg$/.test(item.file)
      : role === 'extra-reference' ? !/^extra-(you|partner)\.jpg$/.test(item.file) : !item.file.startsWith(`${role}/`)) throw new Error('Invalid group label');
    return { file: item.file, sha256: item.sha256, role };
  });
  if (new Set(images.map((image) => image.file)).size !== images.length || new Set(images.map((image) => image.sha256)).size !== images.length) throw new Error('Duplicate group source');
  return images;
}

export async function runGroupBenchmark(engine: ReturnType<typeof createFaceRecognitionEngine>, directory: string, sources: Source[], signal: AbortSignal) {
  const uri = (file: string) => pathToFileURL(join(directory, file)).href;
  const prints: Faceprint[] = [];
  const primary: Faceprint[] = [];
  const enrollmentFailures: { file: string; reason: string }[] = [];
  const ensureActive = () => { if (signal.aborted) throw new Error('Test canceled'); };
  try {
    for (const source of sources) {
      ensureActive();
      if (createHash('sha256').update(await readFile(join(directory, source.file))).digest('hex') !== source.sha256) throw new Error('Group source checksum mismatch');
      if (source.role !== 'reference' && source.role !== 'extra-reference') continue;
      const person = source.file.includes('partner') ? 'partner' : 'you';
      try {
        const faces = await engine.detect(uri(source.file));
        if (faces.length !== 1 || !faces[0].landmarks) { enrollmentFailures.push({ file: source.file, reason: 'Reference needs one aligned face' }); continue; }
        const embedding = await engine.embed(uri(source.file), faces[0]);
        const print: Faceprint = { person, embedding };
        prints.push(print);
        if (source.role === 'reference') primary.push(print);
      } catch { enrollmentFailures.push({ file: source.file, reason: 'Reference processing failed' }); }
    }
    const variants = [];
    for (const [name, references] of [['single-reference', primary], ['multiple-references', prints]] as const) {
      const separated = references.some((print) => print.person === 'you') && references.some((print) => print.person === 'partner')
        && !references.some((a) => references.some((b) => a.person !== b.person && cosineSimilarity(a.embedding, b.embedding) >= DEFAULT_MATCH_THRESHOLD));
      const rows = [];
      const queries = sources.filter((source) => source.role === 'both' || source.role === 'not-both');
      if (separated) {
        for (const [index, photo] of queries.entries()) {
          ensureActive();
          rows.push(await testLabeledPhoto(engine, references, { id: `real-${index}`, uri: uri(photo.file), bothPresent: photo.role === 'both' }));
        }
      }
      variants.push({ name, references: references.length, blockedQueries: separated ? 0 : queries.length, ...summarizeTest(rows), rows });
    }
    ensureActive();
    return { modelId: engine.modelId, threshold: DEFAULT_MATCH_THRESHOLD, enrollmentFailures, variants, readyForProduction: false,
      limitations: ['Small hand-selected public-figure diagnostic set, not a held-out accuracy benchmark.', 'Missing downloads and absent negative cases do not count as successful checks.', 'No model, cutoff, or enrollment change in Aoi.'] };
  } finally { prints.forEach((print) => print.embedding.fill(0)); }
}
