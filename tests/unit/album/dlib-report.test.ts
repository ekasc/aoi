import { describe, expect, it } from 'vitest';

import { classifyDlibDistances } from '../../../scripts/classify-dlib-report.mjs';

describe('offline dlib baseline through the shared pair policy', () => {
  it('finds two different qualifying faces without reusing one face twice', () => {
    expect(classifyDlibDistances([{ you: 0.3, partner: 0.8 }, { you: 0.8, partner: 0.4 }]).kind).toBe('pair');
    expect(classifyDlibDistances([{ you: 0.3, partner: 0.4 }]).kind).not.toBe('pair');
  });

  it('does not accept an ambiguous face or a target beyond the experimental distance cutoff', () => {
    expect(classifyDlibDistances([{ you: 0.3, partner: 0.3 }, { you: 0.8, partner: 0.4 }]).kind).not.toBe('pair');
    expect(classifyDlibDistances([{ you: 0.3, partner: 0.8 }, { you: 0.8, partner: 0.601 }]).kind).not.toBe('pair');
    expect(classifyDlibDistances([{ you: 0.3, partner: 0.8 }, { you: 0.8, partner: 0.6 }]).kind).not.toBe('pair');
  });

  it('rejects invalid distances instead of reporting a successful rejection', () => {
    expect(() => classifyDlibDistances([{ you: NaN, partner: 0.4 }])).toThrow();
    expect(() => classifyDlibDistances([{ you: -0.1, partner: 0.4 }])).toThrow();
    expect(() => classifyDlibDistances([{ you: 0.3, partner: Infinity }])).toThrow();
  });
});
