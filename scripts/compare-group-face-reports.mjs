import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function assertPreservedScores(before, after) {
  const remaining = [...after];
  for (const original of before) {
    assert(Number.isFinite(original.you) && Number.isFinite(original.partner), 'Invalid baseline score');
    // Vision observation order is not stable across runs; one-to-one matching must ignore order.
    const index = remaining.findIndex((candidate) => Number.isFinite(candidate.you) && Number.isFinite(candidate.partner)
      && Math.abs(original.you - candidate.you) <= 1e-6 && Math.abs(original.partner - candidate.partner) <= 1e-6);
    assert(index >= 0, 'An original face score changed or disappeared');
    remaining.splice(index, 1);
  }
}

export function compareReports(before, after) {
  assert.equal(after.threshold, before.threshold, 'Recognition cutoff changed');
  assert.equal(after.modelId, before.modelId, 'Reference model changed');
  assert.equal(after.variants.length, before.variants.length);
  for (const variant of before.variants) {
    const updated = after.variants.find((item) => item.name === variant.name);
    assert(updated, 'Reference variant disappeared');
    assert.equal(updated.references, variant.references);
    assert.equal(updated.rows.length, variant.rows.length);
    for (const row of variant.rows) {
      const current = updated.rows.find((item) => item.id === row.id);
      assert(current, 'Query disappeared');
      assert(Number.isSafeInteger(row.detected) && row.detected >= 0 && Number.isSafeInteger(current.detected), 'Cannot compare failed detection reads');
      assert(current.detected >= row.detected, 'Original face detection count decreased');
      assertPreservedScores(row.scores, current.scores);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [before, after] = process.argv.slice(2);
  assert(before && after, 'Use before-report.json and after-report.json');
  compareReports(JSON.parse(await readFile(before, 'utf8')), JSON.parse(await readFile(after, 'utf8')));
  console.log('Original scored detections and reference model preserved, independent of Vision observation order.');
}
