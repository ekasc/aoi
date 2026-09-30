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
