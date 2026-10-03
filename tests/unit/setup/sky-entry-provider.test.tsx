import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import * as Reanimated from 'react-native-reanimated';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SkyEntryProvider, useSkyEntry } from '@/components/home/sky-entry-provider';
import { haptics } from '@/features/haptics/haptics';

vi.mock('@/features/haptics/haptics', () => ({ haptics: { tap: vi.fn(), soft: vi.fn() } }));
const details = { kind: 'created' as const, name: 'Maya & June', photoUri: null, inviteCode: 'MAYA16', partnerName: '' };

function Harness() {
  const { entry, progress, prepare, reveal, enter } = useSkyEntry();
  return createElement('div', null,
    createElement('button', { onClick: () => prepare(details, createElement('div', null, 'Outgoing form')) }, 'Prepare'),
    createElement('button', { onClick: reveal }, 'Reveal'),
    createElement('button', { onClick: enter }, 'Enter'),
    // Drives the master clock by hand, so a reaction that exists to notice the
    // clock crossing a threshold can be tested. The UI runtime is what would
    // normally produce those intermediate values.
    createElement('button', { onClick: () => progress?.set(0) }, 'ClockLow'),
    createElement('button', { onClick: () => progress?.set(1) }, 'ClockHigh'),
    createElement('span', { 'data-testid': 'phase' }, entry?.kind ?? 'home'),
    createElement('span', { 'data-testid': 'camera' }, progress?.value));
}

describe('Memories sky entry', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('waits for Enter on the destination before moving, then clears the invitation', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    let complete: Parameters<typeof Reanimated.withTiming>[2];
    const timing = vi.spyOn(Reanimated, 'withTiming').mockImplementation((value, _config, callback) => {
      complete = callback;
      return value;
    });
    render(createElement(SkyEntryProvider, null, createElement(Harness)));
    expect(screen.getByTestId('camera').textContent).toBe('1');
    fireEvent.click(screen.getByText('Prepare'));
    expect(screen.getByTestId('phase').textContent).toBe('arriving');
    expect(screen.getByTestId('camera').textContent).toBe('0');
    expect(timing).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Enter'));
    expect(timing).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Reveal'));
    expect(timing).not.toHaveBeenCalled();
    act(() => frames[0](0));
    expect(timing).not.toHaveBeenCalled();
    act(() => frames[1](16));
    act(() => complete?.(true));
    expect(screen.getByTestId('phase').textContent).toBe('welcome');
    timing.mockClear();
    fireEvent.click(screen.getByText('Enter'));
    fireEvent.click(screen.getByText('Enter'));
    expect(timing).toHaveBeenCalledOnce();
    expect(haptics.tap).toHaveBeenCalledOnce();
    expect(screen.getByTestId('phase').textContent).toBe('fading');
    act(() => complete?.(true));
    expect(screen.getByTestId('phase').textContent).toBe('home');
    expect(screen.getByTestId('camera').textContent).toBe('1');
    expect(haptics.soft).not.toHaveBeenCalled();
  });

  it('lands the sky with one haptic, partway through the arrival', () => {
    // The landing is the moment the space becomes real, so the one haptic
    // belongs there rather than at the end of the move. Driven through the
    // reaction, because the crossing is the thing being tested.
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    let complete: Parameters<typeof Reanimated.withTiming>[2];
    vi.spyOn(Reanimated, 'withTiming').mockImplementation((value, _config, callback) => {
      complete = callback;
      return value;
    });
    render(createElement(SkyEntryProvider, null, createElement(Harness)));
    fireEvent.click(screen.getByText('Prepare'));
    fireEvent.click(screen.getByText('Reveal'));
    act(() => frames[0](0));
    act(() => frames[1](16));
    act(() => complete?.(true));
    vi.clearAllMocks();

    fireEvent.click(screen.getByText('Enter'));
    const flush = (globalThis as unknown as Record<string, () => void>).__flushReactions;

    // Below the threshold: the sky has not landed, so nothing yet.
    act(() => {
      fireEvent.click(screen.getByText('ClockLow'));
      flush();
    });
    expect(haptics.soft).not.toHaveBeenCalled();

    // Past it: one soft landing.
    act(() => {
      fireEvent.click(screen.getByText('ClockHigh'));
      flush();
    });
    expect(haptics.soft).toHaveBeenCalledOnce();

    // And only once, however many times the reaction re-runs past it.
    act(() => flush());
    act(() => flush());
    expect(haptics.soft).toHaveBeenCalledOnce();

    // A later arrival lands again: the guard is per crossing, not forever.
    act(() => {
      fireEvent.click(screen.getByText('ClockLow'));
      flush();
    });
    act(() => {
      fireEvent.click(screen.getByText('ClockHigh'));
      flush();
    });
    expect(haptics.soft).toHaveBeenCalledTimes(2);
  });

  it('does not replay setup on a normal launch', () => {
    const timing = vi.spyOn(Reanimated, 'withTiming');
    render(createElement(SkyEntryProvider, null, createElement(Harness)));
    expect(screen.getByTestId('phase').textContent).toBe('home');
    expect(screen.getByTestId('camera').textContent).toBe('1');
    fireEvent.click(screen.getByText('Enter'));
    expect(timing).not.toHaveBeenCalled();
    expect(haptics.tap).not.toHaveBeenCalled();
  });

  it('reveals home immediately under reduced motion', () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const timing = vi.spyOn(Reanimated, 'withTiming');
    render(createElement(SkyEntryProvider, null, createElement(Harness)));
    fireEvent.click(screen.getByText('Prepare'));
    fireEvent.click(screen.getByText('Reveal'));
    fireEvent.click(screen.getByText('Enter'));
    expect(screen.getByTestId('camera').textContent).toBe('1');
    expect(screen.getByTestId('phase').textContent).toBe('home');
    expect(timing).not.toHaveBeenCalled();
    expect(haptics.soft).not.toHaveBeenCalled();
  });
});
