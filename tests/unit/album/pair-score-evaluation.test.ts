import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { exportEvaluation, type EvaluationSample } from '@/features/album/album-evaluation';

const fixture = resolve('tests/fixtures/album/synthetic-pair-scores.json');
function run(file: string) {
  return spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/evaluate-pair-scores.mjs', file], { encoding: 'utf8', timeout: 10000 });
}

describe('offline pair-score evaluation CLI', () => {
  it('accepts the on-device score export, including provenance and failure counts, without photos', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aoi-score-test-'));
    try {
      const dataset: { samples: EvaluationSample[] } = JSON.parse(readFileSync(fixture, 'utf8'));
      const file = join(directory, 'scores.json');
      writeFileSync(file, exportEvaluation({ samples: dataset.samples, processingFailures: 2, lastPhoto: null }, 'sface-test'));
      const result = run(file);
      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.modelId).toBe('sface-test'); expect(report.processingFailures).toBe(2);
      expect(report.readyForProduction).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('uses the real policy on disjoint synthetic splits without declaring production readiness', () => {
    const result = run(fixture);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.baseline.validation).toMatchObject({ truePositives: 0, falseNegatives: 1 });
    expect(report.candidate).toMatchObject({ threshold: 0.65, validation: { truePositives: 1, falsePositives: 0 } });
    expect(report.candidate.validation.zeroFalsePositiveGroupRateUpper95).toBeGreaterThan(0.7);
    expect(report.readyForProduction).toBe(false);
  });

  it.each(['group-leak', 'no-negatives', 'invalid-score', 'private-path'])('refuses %s datasets without echoing private data', (problem) => {
    const directory = mkdtempSync(join(tmpdir(), 'aoi-score-test-'));
    try {
      const dataset = JSON.parse(readFileSync(fixture, 'utf8'));
      if (problem === 'group-leak') dataset.samples[3].group = dataset.samples[0].group;
      if (problem === 'no-negatives') dataset.samples = dataset.samples.filter((sample: { bothPresent: boolean }) => sample.bothPresent);
      if (problem === 'invalid-score') dataset.samples[0].faces[0].you = 1.1;
      if (problem === 'private-path') dataset.samples[0].photoUri = 'private-photo-path';
      const file = join(directory, 'scores.json'); writeFileSync(file, JSON.stringify(dataset));
      const result = run(file);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toContain('private-photo-path');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('reports validation false positives without using the validation set to retune the candidate', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aoi-score-test-'));
    try {
      const dataset = JSON.parse(readFileSync(fixture, 'utf8'));
      dataset.samples[4].faces = [{ you: 0.7, partner: 0.1 }, { you: 0.1, partner: 0.7 }];
      const file = join(directory, 'scores.json'); writeFileSync(file, JSON.stringify(dataset));
      const result = run(file);
      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.candidate.threshold).toBe(0.65);
      expect(report.candidate.validation.falsePositives).toBe(1);
      expect(report.readyForProduction).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
