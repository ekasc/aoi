import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { SFACE_TEMPLATE } from '@/features/album/face-alignment';
import { matchByCosine } from '@/features/album/face-pipeline';

import { parseGroupSources, runGroupBenchmark } from '../../../scripts/public-group-benchmark';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'aoi-group-test-'));
  const definitions = [
    { file: 'you.jpg', role: 'reference' }, { file: 'partner.jpg', role: 'reference' },
    { file: 'extra-you.jpg', role: 'extra-reference' }, { file: 'extra-partner.jpg', role: 'extra-reference' },
    { file: 'both/group.jpg', role: 'both' }, { file: 'not-both/group.jpg', role: 'not-both' },
  ];
  const images = definitions.map((item) => ({ ...item, sha256: createHash('sha256').update(item.file).digest('hex') }));
  for (const item of images) {
    await mkdir(dirname(join(directory, item.file)), { recursive: true });
    await writeFile(join(directory, item.file), item.file);
  }
  const outputs: Float32Array[] = [];
  const engine = {
    modelId: 'test-only', isAvailable: async () => true, dispose: async () => {}, match: matchByCosine,
    detect: vi.fn(async (uri: string) => {
      const indices = uri.includes('/both/') ? [2, 3] : uri.includes('/not-both/') ? [4, 5] : [uri.includes('extra-') ? uri.includes('partner') ? 3 : 2 : uri.includes('partner') ? 1 : 0];
      return indices.map((x) => ({ x, y: 0, width: 112, height: 112, rollAngle: 0, landmarks: SFACE_TEMPLATE }));
    }),
    embed: vi.fn(async (_uri: string, face: { x: number }) => { const embedding = new Float32Array(128); embedding[face.x] = 1; outputs.push(embedding); return embedding; }),
  };
  return { directory, images, engine, outputs };
}

describe('public group-photo reference comparison', () => {
  it('compares reference variants on identical queries, without reference leakage', async () => {
    const input = await fixture();
    try {
      const report = await runGroupBenchmark(input.engine, input.directory, parseGroupSources({ images: input.images }), new AbortController().signal);
      expect(report.variants[0]).toMatchObject({ references: 2, found: 0, missed: 1, rejected: 1, threshold: 0.72 });
      expect(report.variants[1]).toMatchObject({ references: 4, found: 1, missed: 0, rejected: 1, threshold: 0.72 });
      expect(report.enrollmentFailures).toEqual([]);
      expect(report.readyForProduction).toBe(false);
      expect(JSON.stringify(report)).not.toContain(input.directory);
      expect(input.outputs.every((value) => value.every((number) => number === 0))).toBe(true);
    } finally { await rm(input.directory, { recursive: true, force: true }); }
  });

  it('keeps failed primary enrollment blocked rather than silently replacing its reference', async () => {
    const input = await fixture();
    try {
      input.engine.detect.mockResolvedValueOnce([]);
      const report = await runGroupBenchmark(input.engine, input.directory, parseGroupSources({ images: input.images }), new AbortController().signal);
      expect(report.enrollmentFailures).toHaveLength(1);
      expect(report.variants[0]).toMatchObject({ blockedQueries: 2, positiveChecks: 0, negativeChecks: 0 });
      expect(report.variants[1]).toMatchObject({ references: 3, found: 1 });
    } finally { await rm(input.directory, { recursive: true, force: true }); }
  });

  it('does not confuse absent negative data with a zero false-positive rate', async () => {
    const input = await fixture();
    try {
      const images = input.images.filter((source) => source.role !== 'not-both');
      const report = await runGroupBenchmark(input.engine, input.directory, parseGroupSources({ images }), new AbortController().signal);
      expect(report.variants.every((variant) => variant.falsePositiveRate === null)).toBe(true);
    } finally { await rm(input.directory, { recursive: true, force: true }); }
  });

  it('rejects traversal, circular labels, duplicates and changed content', async () => {
    const input = await fixture();
    try {
      expect(() => parseGroupSources({ images: [{ ...input.images[0], file: '../private.jpg' }] })).toThrow();
      expect(() => parseGroupSources({ images: [{ ...input.images[0], role: 'both' }] })).toThrow();
      expect(() => parseGroupSources({ images: [input.images[0], input.images[0]] })).toThrow();
      await writeFile(join(input.directory, 'partner.jpg'), 'changed');
      await expect(runGroupBenchmark(input.engine, input.directory, parseGroupSources({ images: input.images }), new AbortController().signal)).rejects.toThrow('checksum');
      expect(input.outputs.every((value) => value.every((number) => number === 0))).toBe(true);
    } finally { await rm(input.directory, { recursive: true, force: true }); }
  });
});
