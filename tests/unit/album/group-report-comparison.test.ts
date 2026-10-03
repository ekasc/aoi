import { describe, expect, it } from 'vitest';

import { assertPreservedScores } from '../../../scripts/compare-group-face-reports.mjs';

describe('Vision observation comparison', () => {
  const a = { you: 0.8, partner: 0.1 }, b = { you: 0.1, partner: 0.7 };
  it('compares unchanged scores regardless of native observation order', () => {
    expect(() => assertPreservedScores([a, b], [b, a])).not.toThrow();
    expect(() => assertPreservedScores([a], [b, a])).not.toThrow();
  });
  it('does not let one new observation stand in for two old observations', () => {
    expect(() => assertPreservedScores([a, a], [a, b])).toThrow();
  });
  it('rejects lost, changed, or invalid scores', () => {
    expect(() => assertPreservedScores([a], [])).toThrow();
    expect(() => assertPreservedScores([a], [{ ...a, you: 0.6 }])).toThrow();
    expect(() => assertPreservedScores([a], [{ ...a, partner: NaN }])).toThrow();
  });
});
