import { describe, expect, it } from 'vitest';

import { waveformBarCount, waveformBars } from '@/features/media/waveform';

describe('waveformBars', () => {
  it('is deterministic per seed, so a note keeps its shape', () => {
    expect(waveformBars('m-1:audio', 12)).toEqual(waveformBars('m-1:audio', 12));
    expect(waveformBars('m-1:audio', 12)).not.toEqual(waveformBars('m-2:audio', 12));
  });

  it('draws the count it was asked for, inside a legible range', () => {
    const bars = waveformBars('seed', 24);
    expect(bars).toHaveLength(24);
    for (const bar of bars) {
      expect(bar).toBeGreaterThanOrEqual(0.22);
      expect(bar).toBeLessThanOrEqual(1);
    }
  });

  it('never returns a run of identical bars for a real key', () => {
    const bars = waveformBars('preview-voice-partner:audio', 16);
    expect(new Set(bars).size).toBeGreaterThan(8);
  });

  it('handles an empty seed and an empty request', () => {
    expect(waveformBars('', 0)).toEqual([]);
    expect(waveformBars('', 4)).toHaveLength(4);
  });
});

describe('waveformBarCount', () => {
  it('fits the width without letting the bars vanish', () => {
    expect(waveformBarCount(340, 3, 3)).toBe(56);
    expect(waveformBarCount(20, 3, 3)).toBe(8);
  });
});
