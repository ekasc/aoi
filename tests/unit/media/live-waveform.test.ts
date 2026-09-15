import { describe, expect, it } from 'vitest';

import { envelopeFromFrames, smoothLevels, waveformColumnCount } from '@/hooks/use-live-waveform';

describe('envelopeFromFrames', () => {
  it('reports the peak of each slice, not an average of it', () => {
    // Eight frames into four bars: each bar holds a loud frame and a quiet
    // one. A peak envelope keeps the loud one, which is what a waveform
    // shows; an average would halve it and lose the transient.
    const frames = [0.5, 0.1, 0.2, 0.9, -0.8, 0.05, 0.3, 0.02];
    expect(envelopeFromFrames(frames, 4)).toEqual([0.5, 0.9, 0.8, 0.3]);
  });

  it('is silent for silence and never leaves 0..1', () => {
    expect(envelopeFromFrames([0, 0, 0, 0], 2)).toEqual([0, 0]);
    expect(envelopeFromFrames([-2, 3], 2)).toEqual([1, 1]);
  });

  it('reads negative samples by magnitude, so a wave is symmetric', () => {
    expect(envelopeFromFrames([-0.9, 0.1], 2)).toEqual([0.9, 0.1]);
  });

  it('handles more bars than frames without inventing data', () => {
    const levels = envelopeFromFrames([0.4, 0.8], 5);
    expect(levels).toHaveLength(5);
    expect(Math.max(...levels)).toBe(0.8);
    expect(levels.filter((level) => level === 0).length).toBeGreaterThan(0);
  });

  it('returns nothing for nothing', () => {
    expect(envelopeFromFrames([], 4)).toEqual([0, 0, 0, 0]);
    expect(envelopeFromFrames([0.5], 0)).toEqual([]);
  });
});


describe('smoothLevels', () => {
  it('moves each bar halfway toward the new window, so updates do not flicker', () => {
    // A sample update arrives ~30 times a second, each a fresh window. Drawn
    // raw the wave jumps; blended it reads as movement.
    expect(smoothLevels([0.9, 0.9], [0.1, 0.9])).toEqual([0.5, 0.9]);
  });

  it('draws the first window as measured, having nothing to blend with', () => {
    expect(smoothLevels([], [0.4, 0.8])).toEqual([0.4, 0.8]);
  });

  it('takes the factor it is given', () => {
    expect(smoothLevels([1, 1], [0, 0], 1)).toEqual([0, 0]);
    expect(smoothLevels([1, 1], [0, 0], 0.25)).toEqual([0.75, 0.75]);
  });
});

describe('waveformColumnCount', () => {
  it('fills the width it is given, within sane limits', () => {
    // 358pt of usable width at 3pt bars and 2pt gaps.
    expect(waveformColumnCount(358, 3, 2)).toBe(71);
    expect(waveformColumnCount(20, 3, 2)).toBe(12);
    expect(waveformColumnCount(4000, 3, 2)).toBe(96);
  });
});
