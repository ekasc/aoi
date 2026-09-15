import { describe, expect, it } from 'vitest';

import { scrubFractionForOffset, scrubSecondsForOffset } from '@/features/moments/audio-scrub';

describe('scrubFractionForOffset', () => {
  it('turns a finger position on the waveform into a fraction of the note', () => {
    expect(scrubFractionForOffset(0, 200)).toBe(0);
    expect(scrubFractionForOffset(50, 200)).toBe(0.25);
    expect(scrubFractionForOffset(200, 200)).toBe(1);
  });

  it('clamps at both ends: the wave has no time outside itself', () => {
    expect(scrubFractionForOffset(-40, 200)).toBe(0);
    expect(scrubFractionForOffset(320, 200)).toBe(1);
  });

  it('is safe before the wave has been measured', () => {
    expect(scrubFractionForOffset(40, 0)).toBe(0);
    expect(scrubFractionForOffset(Number.NaN, 200)).toBe(0);
  });
});

describe('scrubSecondsForOffset', () => {
  it('maps the same positions onto the recording', () => {
    expect(scrubSecondsForOffset(0, 200, 33)).toBe(0);
    expect(scrubSecondsForOffset(100, 200, 33)).toBe(16.5);
    expect(scrubSecondsForOffset(200, 200, 33)).toBe(33);
  });

  it('stays at zero until the duration is known', () => {
    expect(scrubSecondsForOffset(100, 200, 0)).toBe(0);
    expect(scrubSecondsForOffset(100, 200, Number.NaN)).toBe(0);
  });
});
