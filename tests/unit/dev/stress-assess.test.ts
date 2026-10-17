import { expect, it } from 'vitest';

import { assessStressReport } from '../../../scripts/stress-assess.mjs';

it('does not confuse successful actions with acceptable performance', () => {
  const result = assessStressReport({ device: { foreground: { valid: true }, results: [{ ok: true, name: 'scroll', worstGapMs: 1000 }], loaded: { maxPageMs: 1200 } } });
  expect(result.passed).toBe(false);
  expect(result.violations.map(row => row.action)).toEqual(['scroll', 'pagination']);
});

it('fails for incomplete runs and failed API requests', () => {
  const result = assessStressReport({ failure: 'timeout', api: [{ concurrency: 50, failures: [{ status: 500 }] }] });
  expect(result.passed).toBe(false);
  expect(result.violations.map(row => row.action)).toEqual(['api-load', 'incomplete-run']);
});

it('rejects an error overlay even when underlying handlers succeeded', () => {
  expect(assessStressReport({ web: { results: [], errorOverlay: true } }).passed).toBe(false);
});

it('accepts an exercised run inside the stated diagnostic budgets', () => {
  expect(assessStressReport({ device: { foreground: { valid: true }, results: [{ ok: true, name: 'scroll', worstGapMs: 20 }], loaded: { maxPageMs: 100 } } }).passed).toBe(true);
});

it('rejects old or interrupted device timings without blaming app performance', () => {
  const result = assessStressReport({ device: { results: [{ ok: true, name: 'scroll', worstGapMs: 3000 }] } });
  expect(result.violations.map(row => row.action)).toEqual(['invalid-foreground-measurement']);
});
