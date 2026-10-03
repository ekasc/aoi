import { readFile } from 'node:fs/promises';

import { DEFAULT_MATCH_THRESHOLD, matchPairByScores, PAIR_MATCH_POLICY_VERSION } from '../features/album/face-pipeline.ts';

const scoreIsValid = (value) => typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1;
const hasOnlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));

function parseDataset(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || !Array.isArray(value.samples)
    || !hasOnlyKeys(value, ['version', 'samples', 'modelId', 'policyVersion', 'currentThreshold', 'processingFailures'])) throw new Error('Expected version 1 and samples. Do not include photos, paths or embeddings.');
  if (value.modelId !== undefined && (typeof value.modelId !== 'string' || !/^[a-z0-9:._-]{1,200}$/.test(value.modelId))) throw new Error('Invalid model metadata.');
  if (value.policyVersion !== undefined && value.policyVersion !== PAIR_MATCH_POLICY_VERSION) throw new Error('Dataset uses a different matching policy.');
  if (value.currentThreshold !== undefined && (!scoreIsValid(value.currentThreshold) || value.currentThreshold <= 0)) throw new Error('Invalid threshold metadata.');
  if (value.processingFailures !== undefined && (!Number.isSafeInteger(value.processingFailures) || value.processingFailures < 0)) throw new Error('Invalid failure count.');
  const groups = new Map();
  for (const sample of value.samples) {
    if (!sample || typeof sample !== 'object' || !hasOnlyKeys(sample, ['split', 'group', 'bothPresent', 'faces'])
      || !['calibration', 'validation'].includes(sample.split) || typeof sample.group !== 'string' || !sample.group.trim()
      || typeof sample.bothPresent !== 'boolean' || !Array.isArray(sample.faces)
      || !sample.faces.every((face) => face && typeof face === 'object' && hasOnlyKeys(face, ['you', 'partner'])
        && scoreIsValid(face.you) && scoreIsValid(face.partner))) {
      throw new Error('Each sample needs split, anonymous group, bothPresent and finite per-face you/partner scores between -1 and 1.');
    }
    const previous = groups.get(sample.group);
    if (previous && previous !== sample.split) throw new Error('Calibration and validation groups must be disjoint.');
    groups.set(sample.group, sample.split);
  }
  for (const split of ['calibration', 'validation']) {
    const samples = value.samples.filter((sample) => sample.split === split);
    if (!samples.some((sample) => sample.bothPresent) || !samples.some((sample) => !sample.bothPresent)) {
      throw new Error('Both splits need positive and negative samples. Include solo, unrelated and group-photo negatives.');
    }
  }
  return value.samples;
}

function evaluate(samples, threshold) {
  let truePositives = 0, falsePositives = 0, trueNegatives = 0, falseNegatives = 0;
  for (const sample of samples) {
    const accepted = matchPairByScores(sample.faces, threshold).kind === 'pair';
    if (sample.bothPresent) {
      if (accepted) truePositives++; else falseNegatives++;
    } else {
      if (accepted) falsePositives++; else trueNegatives++;
    }
  }
  const positives = truePositives + falseNegatives;
  const negatives = falsePositives + trueNegatives;
  const independentNegativeGroups = new Set(samples.filter((sample) => !sample.bothPresent).map((sample) => sample.group)).size;
  return { samples: samples.length, positives, negatives, truePositives, falsePositives, trueNegatives, falseNegatives,
    recall: truePositives / positives, falsePositiveRate: falsePositives / negatives,
    independentNegativeGroups,
    zeroFalsePositiveGroupRateUpper95: falsePositives === 0 ? 1 - 0.05 ** (1 / independentNegativeGroups) : null };
}

async function main() {
  const [file, ...extra] = process.argv.slice(2);
  if (!file || extra.length) throw new Error('Usage: node --experimental-strip-types scripts/evaluate-pair-scores.mjs <scores.json>');
  const dataset = JSON.parse(await readFile(file, 'utf8'));
  const samples = parseDataset(dataset);
  const calibration = samples.filter((sample) => sample.split === 'calibration');
  const validation = samples.filter((sample) => sample.split === 'validation');
  const thresholds = new Set([DEFAULT_MATCH_THRESHOLD, 1]);
  for (const sample of calibration) for (const face of sample.faces) {
    for (const score of [face.you, face.partner]) {
      if (score > 0) thresholds.add(score);
      if (score + 1e-6 > 0 && score + 1e-6 <= 1) thresholds.add(score + 1e-6);
    }
  }
  let candidate = null;
  for (const threshold of [...thresholds].sort((a, b) => b - a)) {
    const metrics = evaluate(calibration, threshold);
    if (metrics.falsePositives === 0 && metrics.truePositives > 0
      && (!candidate || metrics.truePositives > candidate.calibration.truePositives)) {
      candidate = { threshold, calibration: metrics };
    }
  }
  if (candidate) candidate.validation = evaluate(validation, candidate.threshold);
  console.log(JSON.stringify({ policy: PAIR_MATCH_POLICY_VERSION, modelId: dataset.modelId ?? null, processingFailures: dataset.processingFailures ?? 0, currentThreshold: DEFAULT_MATCH_THRESHOLD,
    baseline: { calibration: evaluate(calibration, DEFAULT_MATCH_THRESHOLD), validation: evaluate(validation, DEFAULT_MATCH_THRESHOLD) },
    candidate, readyForProduction: false,
    warning: 'Empirical candidates only. Synthetic fixtures do not calibrate recognition. Small or biased real datasets cannot establish safety. No app settings were changed.' }, null, 2));
}

try { await main(); }
catch {
  // Input and filesystem errors may contain private paths or identifiers.
  console.error('Evaluation failed. Supply a valid score-only JSON dataset with disjoint groups and both labels in each split. No settings were changed.');
  process.exitCode = 1;
}
