import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { parsePublicBenchmark, runPublicBenchmark } from '../../../scripts/public-face-benchmark';
import { SFACE_TEMPLATE } from '@/features/album/face-alignment';
import { matchByCosine } from '@/features/album/face-pipeline';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'aoi-public-face-benchmark-'));
  const identities = [];
  for (let index = 0; index < 4; index++) {
    const label = `identity-${String(index).padStart(3, '0')}`;
    await mkdir(join(directory, label));
    const images = [];
    for (let sample = 0; sample < 2; sample++) {
      const file = `${label}/image-${String(sample).padStart(2, '0')}.png`, content = `${label}:${sample}`;
      await writeFile(join(directory, file), content);
      images.push({ file, sha256: createHash('sha256').update(content).digest('hex') });
    }
    identities.push({ label, images });
  }
  const pairCases = [0, 2].map((index, pairIndex) => ({
    label: `pair-0${pairIndex}`, you: identities[index].label, partner: identities[index + 1].label,
    photos: [
      { file: `pair-0${pairIndex}/both/pair-01.png`, bothPresent: true, sourceImages: [identities[index].images[1].file, identities[index + 1].images[1].file] },
      { file: `pair-0${pairIndex}/not-both/unrelated-01.png`, bothPresent: false, sourceImages: [identities[index].images[1].file, identities[(index + 2) % 4].images[1].file] },
    ],
  })).map((pair) => ({ ...pair, photos: pair.photos.map((photo) => ({ ...photo, sha256: createHash('sha256').update(photo.file).digest('hex') })) }));
  for (const pair of pairCases) {
    for (const photo of pair.photos) {
      await mkdir(dirname(join(directory, photo.file)), { recursive: true });
      await writeFile(join(directory, photo.file), photo.file);
    }
  }
  const manifest = { dataset: 'HyperFace-10k-LDM', synthetic: true, license: 'CC-BY-SA-4.0', source: 'https://zenodo.org/api/records/15087238', identities, pairCases };
  const created: Float32Array[] = [];
  const engine = {
    modelId: 'synthetic-test-model', isAvailable: vi.fn(async () => true), dispose: vi.fn(async () => {}), match: matchByCosine,
    detect: vi.fn(async (uri: string) => {
      const index = uri.includes('pair-01/') ? 2 : 0;
      const labels = uri.includes('/pair-') ? uri.includes('/both/') ? [index, index + 1] : [index, (index + 2) % 4] : [Number(uri.match(/identity-(\d+)/)?.[1])];
      return labels.map((x) => ({ x, y: 0, width: 112, height: 112, rollAngle: 0, landmarks: SFACE_TEMPLATE }));
    }),
    embed: vi.fn(async (_uri: string, face: { x: number }) => { const embedding = new Float32Array(128); embedding[face.x] = 1; created.push(embedding); return embedding; }),
  };
  return { directory, manifest, engine, created };
}

describe('independently labeled public synthetic benchmark', () => {
  it('applies experimental thresholds to the scanner and rejects invalid values', async () => {
    const input = await fixture();
    try {
      const benchmark = parsePublicBenchmark(input.manifest);
      const report = await runPublicBenchmark(input.engine, input.directory, benchmark, new AbortController().signal, undefined, 0.39);
      expect(report.pairClassification).toMatchObject({ found: 2, rejected: 2, threshold: 0.39 });
      for (const threshold of [NaN, 0, -1, 2]) {
        await expect(runPublicBenchmark(input.engine, input.directory, benchmark, new AbortController().signal, undefined, threshold)).rejects.toThrow('threshold');
      }
    } finally { await rm(input.directory, { recursive: true, force: true }); }
  });
  it('tests identity verification, known/unknown face classification and actual pair scanning separately', async () => {
    const input = await fixture();
    try {
      const report = await runPublicBenchmark(input.engine, input.directory, parsePublicBenchmark(input.manifest), new AbortController().signal);
      expect(report.identityVerification.genuine).toEqual({ accepted: 4, rejected: 0, failed: 0 });
      expect(report.identityVerification.impostor).toEqual({ accepted: 0, rejected: 12, failed: 0 });
      expect(report.faceClassification).toEqual({ correctKnown: 4, missedKnown: 0, wrongKnown: 0, correctUnknown: 4, falseKnown: 0, failed: 0 });
      expect(report.pairClassification).toMatchObject({ found: 2, rejected: 2, attempted: 4, blockedPhotos: 0, threshold: 0.72 });
      expect(report.readyForProduction).toBe(false);
      expect(input.created.every((embedding) => embedding.every((value) => value === 0))).toBe(true);
      expect(JSON.stringify(report)).not.toContain(input.directory);
    } finally { await rm(input.directory, { recursive: true, force: true }); }
  });
  it('counts failed references and blocked pair cases instead of reporting zero mistakes as success', async () => {
    const input = await fixture();
    try {
      input.engine.detect.mockResolvedValueOnce([]);
      const report = await runPublicBenchmark(input.engine, input.directory, parsePublicBenchmark(input.manifest), new AbortController().signal);
      expect(report.processingFailures).toEqual([{ file: 'identity-000/image-00.png', stage: 'no-face' }]);
      expect(report.identityVerification.genuine.failed).toBe(1);
      expect(report.identityVerification.impostor.failed).toBe(3);
      expect(report.pairClassification).toMatchObject({ attempted: 2, blockedPhotos: 2 });
      expect(report.pairFailures).toHaveLength(1);
    } finally { await rm(input.directory, { recursive: true, force: true }); }
  });
  it('rejects changed licenses, path traversal, duplicates and circular reference testing', async () => {
    const input = await fixture();
    try {
      expect(() => parsePublicBenchmark({ ...input.manifest, license: 'research-only' })).toThrow();
      const traversal = structuredClone(input.manifest); traversal.identities[0].images[1].file = '../private.png';
      expect(() => parsePublicBenchmark(traversal)).toThrow();
      const duplicate = structuredClone(input.manifest); duplicate.identities[0].images[1].sha256 = duplicate.identities[0].images[0].sha256;
      expect(() => parsePublicBenchmark(duplicate)).toThrow();
      const circular = structuredClone(input.manifest); circular.pairCases[0].photos[0].sourceImages[0] = circular.identities[0].images[0].file;
      expect(() => parsePublicBenchmark(circular)).toThrow();
    } finally { await rm(input.directory, { recursive: true, force: true }); }
  });
  it('checks image hashes and cancellation without retaining embeddings', async () => {
    const input = await fixture();
    try {
      await writeFile(join(input.directory, input.manifest.identities[0].images[0].file), 'changed');
      await expect(runPublicBenchmark(input.engine, input.directory, parsePublicBenchmark(input.manifest), new AbortController().signal)).rejects.toThrow('checksum');
      const abort = new AbortController(); abort.abort();
      await expect(runPublicBenchmark(input.engine, input.directory, parsePublicBenchmark(input.manifest), abort.signal)).rejects.toThrow('canceled');
    } finally { await rm(input.directory, { recursive: true, force: true }); }
  });
});
