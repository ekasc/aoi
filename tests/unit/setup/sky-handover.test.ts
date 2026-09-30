import { describe, expect, it } from 'vitest';

import { blendSkyUniforms, settlingSkyHeight, skyBottomFeather } from '@/components/setup/sky-handover';

describe('the sky settling into home', () => {
  it('broadens the moving bottom fade without changing either settled scene', () => {
    expect(skyBottomFeather(0)).toBe(0);
    expect(skyBottomFeather(1)).toBe(0);
    expect(skyBottomFeather(0.5)).toBeCloseTo(0.26);
    expect(skyBottomFeather(0.1)).toBeLessThan(skyBottomFeather(0.3));
    expect(skyBottomFeather(0.7)).toBeCloseTo(skyBottomFeather(0.3));
    expect(skyBottomFeather(0.9)).toBeLessThan(skyBottomFeather(0.7));
  });
  it('stops on the real header instead of travelling offscreen', () => {
    expect(settlingSkyHeight(0, 844, 139)).toBe(844);
    expect(settlingSkyHeight(1, 844, 139)).toBe(139);
    expect(settlingSkyHeight(2, 844, 139)).toBe(139);
    const heights = Array.from({ length: 21 }, (_, i) => settlingSkyHeight(i / 20, 844, 139));
    for (let i = 1; i < heights.length; i += 1) {
      expect(heights[i]).toBeLessThan(heights[i - 1]);
      expect(heights[i]).toBeGreaterThanOrEqual(139);
    }
  });

  it('preserves both endpoint gradients, including colour, lights and geometry', () => {
    const source = { uSize: [393, 844], uPeak: 0.85, uMid: [0.1, 0.05, 0.12, 1] };
    const target = { uSize: [393, 139], uPeak: 0.42, uMid: [0.3, 0.12, 0.4, 1] };
    expect(blendSkyUniforms(source, target, 0)).toEqual(source);
    const end = blendSkyUniforms(source, target, 1);
    expect(end.uSize).toEqual(target.uSize);
    expect(end.uPeak).toBeCloseTo(target.uPeak);
    expect(end.uMid).toEqual(target.uMid);
    expect(blendSkyUniforms(source, target, 0.5).uSize).toEqual([393, 491.5]);
  });
});
