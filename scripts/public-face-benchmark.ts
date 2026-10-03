import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { cosineSimilarity, DEFAULT_MATCH_THRESHOLD, type Faceprint } from '@/features/album/face-pipeline';
import type { createFaceRecognitionEngine } from '@/features/album/face-recognition-engine';

import { summarizeTest, testLabeledPhoto, type PhotoResult } from './face-test-core';

type Image = { file: string; sha256: string };
type Identity = { label: string; images: Image[] };
type Case = { label: string; you: string; partner: string; photos: { file: string; sha256: string; bothPresent: boolean; sourceImages: string[] }[] };
export type Benchmark = { dataset: 'HyperFace-10k-LDM'; license: 'CC-BY-SA-4.0'; source: string; identities: Identity[]; pairCases: Case[] };
type Engine = ReturnType<typeof createFaceRecognitionEngine>;

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => new Error('Invalid synthetic benchmark manifest');
function imagePath(value: unknown): string {
  if (typeof value !== 'string' || !/^identity-\d{3}\/image-\d{2}\.(png|jpe?g)$/.test(value)) throw invalid();
  return value;
}

export function parsePublicBenchmark(value: unknown): Benchmark {
  if (!isObject(value) || value.dataset !== 'HyperFace-10k-LDM' || value.synthetic !== true || value.license !== 'CC-BY-SA-4.0'
    || value.source !== 'https://zenodo.org/api/records/15087238' || !Array.isArray(value.identities) || value.identities.length < 4 || !Array.isArray(value.pairCases) || value.pairCases.length * 2 !== value.identities.length) throw invalid();
  const identities = value.identities.map((item): Identity => {
    if (!isObject(item) || typeof item.label !== 'string' || !/^identity-\d{3}$/.test(item.label) || !Array.isArray(item.images) || item.images.length < 2) throw invalid();
    const label = item.label;
    return { label, images: item.images.map((image): Image => {
      if (!isObject(image) || typeof image.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(image.sha256)) throw invalid();
      const file = imagePath(image.file);
      if (!file.startsWith(`${label}/`)) throw invalid();
      return { file, sha256: image.sha256 };
    }) };
  });
  const files = new Map(identities.flatMap((identity) => identity.images.map((image, index) => [image.file, { label: identity.label, reference: index === 0 }] as const)));
  const allImages = identities.flatMap((identity) => identity.images);
  if (files.size !== allImages.length || new Set(allImages.map((image) => image.sha256)).size !== allImages.length || new Set(identities.map((identity) => identity.label)).size !== identities.length) throw invalid();
  const pairCases = value.pairCases.map((item): Case => {
    if (!isObject(item) || typeof item.label !== 'string' || !/^pair-\d{2}$/.test(item.label) || typeof item.you !== 'string' || typeof item.partner !== 'string'
      || item.you === item.partner || !identities.some((identity) => identity.label === item.you) || !identities.some((identity) => identity.label === item.partner) || !Array.isArray(item.photos) || !item.photos.length) throw invalid();
    const label = item.label, you = item.you, partner = item.partner;
    const photos = item.photos.map((photo) => {
      if (!isObject(photo) || typeof photo.file !== 'string' || !new RegExp(`^${label}/(both|not-both)/[a-z-]+-\\d{2}\\.png$`).test(photo.file)
        || typeof photo.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(photo.sha256)
        || typeof photo.bothPresent !== 'boolean' || !Array.isArray(photo.sourceImages) || photo.sourceImages.length < 1 || photo.sourceImages.length > 3) throw invalid();
      const sourceImages = photo.sourceImages.map(imagePath);
      const sources = sourceImages.map((file) => files.get(file));
      if (sources.some((source) => !source || source.reference)) throw invalid();
      const bothPresent = sources.some((source) => source?.label === you) && sources.some((source) => source?.label === partner);
      if (bothPresent !== photo.bothPresent || photo.file.includes('/both/') !== bothPresent) throw invalid();
      return { file: photo.file, sha256: photo.sha256, bothPresent, sourceImages };
    });
    if (!photos.some((photo) => photo.bothPresent) || !photos.some((photo) => !photo.bothPresent)) throw invalid();
    return { label, you, partner, photos };
  });
  if (new Set(pairCases.map((item) => item.label)).size !== pairCases.length || new Set(pairCases.flatMap((item) => item.photos.map((photo) => photo.file))).size !== pairCases.flatMap((item) => item.photos).length) throw invalid();
  if (new Set(pairCases.flatMap((item) => [item.you, item.partner])).size !== identities.length) throw invalid();
  return { dataset: value.dataset, license: value.license, source: value.source, identities, pairCases };
}

type Counts = { accepted: number; rejected: number; failed: number };
const counts = (): Counts => ({ accepted: 0, rejected: 0, failed: 0 });
function distribution(scores: number[]) {
  if (!scores.length) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1], mean: sorted.reduce((sum, score) => sum + score, 0) / sorted.length };
}

export async function runPublicBenchmark(engine: Engine, directory: string, benchmark: Benchmark, signal: AbortSignal, progress: (message: string) => void = () => {}, threshold = DEFAULT_MATCH_THRESHOLD) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) throw new RangeError('Invalid benchmark threshold');
  const embeddings = new Map<string, Float32Array>();
  const failures: { file: string; stage: string }[] = [];
  const uri = (file: string) => pathToFileURL(resolve(directory, file)).href;
  const ensureActive = () => { if (signal.aborted) throw new Error('Benchmark canceled'); };
  try {
    for (const identity of benchmark.identities) {
      for (const [index, image] of identity.images.entries()) {
        ensureActive();
        if (createHash('sha256').update(await readFile(resolve(directory, image.file))).digest('hex') !== image.sha256) throw new Error('Synthetic image checksum mismatch');
        let stage = 'detection';
        try {
          const faces = await engine.detect(uri(image.file));
          if (faces.length !== 1) { failures.push({ file: image.file, stage: faces.length === 0 ? 'no-face' : 'multiple-faces' }); continue; }
          stage = 'embedding';
          embeddings.set(image.file, await (index === 0 ? engine.embed : engine.embedQuery ?? engine.embed)(uri(image.file), faces[0]));
        } catch { failures.push({ file: image.file, stage }); }
      }
      progress(`Prepared synthetic identity ${identity.label}`);
    }
    const genuine = counts(), impostor = counts();
    const genuineScores: number[] = [], impostorScores: number[] = [];
    for (const identity of benchmark.identities) {
      for (const image of identity.images.slice(1)) {
        for (const reference of benchmark.identities) {
          const same = identity.label === reference.label;
          const tally = same ? genuine : impostor;
          const query = embeddings.get(image.file), enrolled = embeddings.get(reference.images[0].file);
          if (!query || !enrolled) { tally.failed++; continue; }
          const score = cosineSimilarity(query, enrolled);
          (same ? genuineScores : impostorScores).push(score);
          if (score >= threshold) tally.accepted++; else tally.rejected++;
        }
      }
    }
    const faceClassification = { correctKnown: 0, missedKnown: 0, wrongKnown: 0, correctUnknown: 0, falseKnown: 0, failed: 0 };
    const rows: PhotoResult[] = [], pairFailures: { pair: string; reason: string; blockedPhotos: number }[] = [];
    for (const pair of benchmark.pairCases) {
      ensureActive();
      const you = benchmark.identities.find((identity) => identity.label === pair.you);
      const partner = benchmark.identities.find((identity) => identity.label === pair.partner);
      if (!you || !partner) throw invalid();
      const youPrint = embeddings.get(you.images[0].file), partnerPrint = embeddings.get(partner.images[0].file);
      if (!youPrint || !partnerPrint || cosineSimilarity(youPrint, partnerPrint) >= threshold) {
        pairFailures.push({ pair: pair.label, reason: !youPrint || !partnerPrint ? 'Reference processing failed' : 'Reference separation failed', blockedPhotos: pair.photos.length });
        faceClassification.failed += benchmark.identities.reduce((total, identity) => total + identity.images.length - 1, 0);
        continue;
      }
      const prints: Faceprint[] = [{ person: 'you', embedding: youPrint }, { person: 'partner', embedding: partnerPrint }];
      for (const identity of benchmark.identities) {
        for (const image of identity.images.slice(1)) {
          const embedding = embeddings.get(image.file);
          if (!embedding) { faceClassification.failed++; continue; }
          const expected = identity.label === pair.you ? 'you' : identity.label === pair.partner ? 'partner' : null;
          const match = engine.match(embedding, prints, threshold);
          const actual = match.kind === 'match' ? match.person : null;
          if (expected) {
            if (actual === expected) faceClassification.correctKnown++;
            else if (actual === null) faceClassification.missedKnown++;
            else faceClassification.wrongKnown++;
          } else if (actual === null) faceClassification.correctUnknown++;
          else faceClassification.falseKnown++;
        }
      }
      for (const [index, photo] of pair.photos.entries()) {
        ensureActive();
        if (createHash('sha256').update(await readFile(resolve(directory, photo.file))).digest('hex') !== photo.sha256) throw new Error('Synthetic pair checksum mismatch');
        rows.push(await testLabeledPhoto(engine, prints, { id: `${pair.label}:${index}`, uri: uri(photo.file), bothPresent: photo.bothPresent }, threshold));
      }
      progress(`Checked ${pair.label}`);
    }
    ensureActive();
    return {
      dataset: benchmark.dataset, source: benchmark.source, license: benchmark.license, synthetic: true,
      modelId: engine.modelId, images: benchmark.identities.reduce((total, identity) => total + identity.images.length, 0), identities: benchmark.identities.length,
      processingFailures: failures, identityVerification: { genuine, impostor, genuineScores: distribution(genuineScores), impostorScores: distribution(impostorScores) },
      faceClassification, pairClassification: { ...summarizeTest(rows, threshold), blockedPhotos: pairFailures.reduce((sum, item) => sum + item.blockedPhotos, 0), attempted: rows.length },
      pairFailures, rows, readyForProduction: false,
      limitations: ['Small subset selected in archive order, not a representative random sample.', 'Identity labels describe generated synthetic identities, not real people.', 'Pair and group images are artificial portrait mosaics, not natural group scenes.', 'Mac Vision and CPU inference are not an iPhone parity check.', 'Experimental settings are local to this benchmark, not production recommendations.'],
    };
  } finally { for (const embedding of embeddings.values()) embedding.fill(0); }
}
