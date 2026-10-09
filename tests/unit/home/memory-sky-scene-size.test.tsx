import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import * as Skia from '@shopify/react-native-skia';
import * as Reanimated from 'react-native-reanimated';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemorySky } from '@/components/home/memory-sky';

describe('Fabric canvas size signal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('waits for a nonzero measured size and signals layout only once', () => {
    let size: Reanimated.SharedValue<{ width: number; height: number }> | undefined;
    const probes: (() => void)[] = [];
    const originalReaction = Reanimated.useAnimatedReaction;
    vi.spyOn(Reanimated, 'useAnimatedReaction').mockImplementation((prepare, react, dependencies) => {
      let previous = prepare();
      probes.push(() => {
        const next = prepare();
        react(next, previous);
        previous = next;
      });
      return originalReaction(prepare, react, dependencies);
    });
    vi.spyOn(Skia, 'Canvas').mockImplementation((props) => {
      expect(props.onLayout).toBeUndefined();
      size = props.onSize;
      return createElement('div');
    });
    const laidOut = vi.fn();
    render(createElement(MemorySky, { compact: true, moments: [], onSceneLayout: laidOut }));
    expect(size).toBeDefined();
    expect(laidOut).not.toHaveBeenCalled();
    act(() => {
      size?.set({ width: 390, height: 0 });
      probes.forEach((probe) => probe());
    });
    expect(laidOut).not.toHaveBeenCalled();
    act(() => {
      size?.set({ width: 390, height: 844 });
      probes.forEach((probe) => probe());
      probes.forEach((probe) => probe());
    });
    expect(laidOut).toHaveBeenCalledOnce();
  });
});
