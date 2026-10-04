import { act, fireEvent, render, screen } from '@testing-library/react';
import * as RN from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PhotoSkyViewport } from '@/components/home/photo-sky-viewport';
import type { SkyItem } from '@/features/home/day-sky';
import { photoSkyStar } from '@/features/home/photo-sky';
import { PHOTO_SKY_OVERVIEW, projectPhotoSkyStar, type PhotoSkyCamera } from '@/features/home/photo-sky-camera';

type Handler = (event: Record<string, number>, success?: boolean) => void;
const state = vi.hoisted(() => ({ handlers: {} as Record<string, Record<string, Handler>>, enabled: {} as Record<string, boolean>, camera: null as { value: PhotoSkyCamera } | null, props: null as RN.ViewProps | null }));
vi.mock('react-native-gesture-handler', () => {
  const gesture = (initial: string) => {
    let name = initial;
    state.handlers[name] = {};
    const chain = {
      enabled(value: boolean) { state.enabled[name] = value; return chain; },
      maxPointers() { return chain; }, minDistance() { return chain; }, maxDistance() { return chain; }, maxDelay() { return chain; },
      numberOfTaps() { name = 'doubleTap'; state.handlers[name] = {}; return chain; },
      onStart(fn: Handler) { state.handlers[name].start = fn; return chain; },
      onUpdate(fn: Handler) { state.handlers[name].update = fn; return chain; },
      onEnd(fn: Handler) { state.handlers[name].end = fn; return chain; },
      onFinalize(fn: Handler) { state.handlers[name].finalize = fn; return chain; },
    };
    return chain;
  };
  return {
    Gesture: { Pan: () => gesture('pan'), Pinch: () => gesture('pinch'), Tap: () => gesture('tap'), Simultaneous: () => ({}), Race: () => ({}), Exclusive: () => ({}) },
    GestureDetector: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});
vi.mock('@/components/home/memory-sky', () => ({ MemorySky: ({ photoCamera }: { photoCamera: { value: PhotoSkyCamera } }) => { state.camera = photoCamera; return <div data-testid="rendered-sky" />; } }));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#444444' }));
const HostView = RN.View;
const originalOS = RN.Platform.OS;
const moments: SkyItem[] = [{ id: 'one', occurredAt: '2026-05-12T12:00:00Z', authorRole: 'you' }];
const viewport = { width: 390, height: 700 };
const flush = () => (globalThis as unknown as { __flushReactions: () => void }).__flushReactions();
const drive = (kind: string, action: string, event: Record<string, number>, success = true) => act(() => { state.handlers[kind][action](event, success); flush(); });
const open = vi.fn();
const mount = (photos = moments) => render(<PhotoSkyViewport moments={photos} height={700} now={new Date()} focused canOpen={photos.length > 0} onOpenPhoto={open} />);
beforeEach(() => {
  vi.clearAllMocks();
  state.handlers = {}; state.enabled = {}; state.props = null; state.camera = null;
  vi.spyOn(RN, 'View').mockImplementation((props) => { if (props.testID === 'photo-sky-viewport') state.props = props; return <HostView {...props} />; });
});
afterEach(() => { vi.restoreAllMocks(); Object.defineProperty(RN.Platform, 'OS', { value: originalOS, configurable: true }); });

describe('photo sky gesture and accessibility contract', () => {
  it('starts in overview without dates or new buttons', () => {
    mount();
    expect(state.camera?.value).toEqual(PHOTO_SKY_OVERVIEW);
    expect(screen.queryByTestId('photo-sky-date')).toBeNull();
    expect(state.props?.accessibilityRole).toBe('adjustable');
    expect(state.props?.accessibilityLabel).toBe('Photo sky');
    expect(state.props?.accessibilityActions?.map((action) => action.name)).toEqual(['increment', 'decrement', 'nextPhoto', 'previousPhoto', 'resetView', 'activate']);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('double-taps a real star into focus and shows its added date underneath', () => {
    mount();
    const point = projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport);
    drive('doubleTap', 'end', point);
    expect(state.camera?.value.zoom).toBe(7);
    expect(screen.getByTestId('photo-sky-date').textContent).toContain('May 12, 2026');
    expect(open).not.toHaveBeenCalled();
  });
  it('pinches around the moving focal point and hides dates again at overview', () => {
    mount();
    const point = projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport);
    drive('pinch', 'start', { focalX: point.x, focalY: point.y });
    drive('pinch', 'update', { focalX: 195, focalY: 350, scale: 6 });
    expect(state.camera?.value.zoom).toBe(6);
    expect(screen.getByTestId('photo-sky-date')).toBeTruthy();
    drive('pinch', 'finalize', {});
    drive('pinch', 'start', { focalX: 195, focalY: 350 });
    drive('pinch', 'update', { focalX: 195, focalY: 350, scale: 0.01 });
    expect(state.camera?.value).toEqual(PHOTO_SKY_OVERVIEW);
    expect(screen.queryByTestId('photo-sky-date')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
  it('converts absolute web pinch coordinates at the viewport boundary without moving the anchor', () => {
    Object.defineProperty(RN.Platform, 'OS', { value: 'web', configurable: true });
    mount();
    const field = screen.getByLabelText('Photo sky');
    Object.assign(field, { measureInWindow: (callback: (x: number, y: number) => void) => callback(0, 64) });
    act(() => state.props?.onLayout?.({} as RN.LayoutChangeEvent));
    const star = photoSkyStar('one');
    const point = projectPhotoSkyStar(star, PHOTO_SKY_OVERVIEW, viewport);
    drive('pinch', 'start', { focalX: point.x, focalY: point.y + 64 });
    drive('pinch', 'update', { focalX: 195, focalY: 414, scale: 6 });
    const projected = projectPhotoSkyStar(star, state.camera!.value, viewport);
    expect(projected.x).toBeCloseTo(195);
    expect(projected.y).toBeCloseTo(350);
  });
  it('swipes continuously without opening a photo, then taps the projected star to open that photo', () => {
    mount();
    const star = photoSkyStar('one');
    drive('doubleTap', 'end', projectPhotoSkyStar(star, PHOTO_SKY_OVERVIEW, viewport));
    drive('pan', 'start', { x: 195, y: 350 });
    drive('pan', 'update', { translationX: 40, translationY: 30 });
    const point = projectPhotoSkyStar(star, state.camera!.value, viewport);
    expect(point.x).toBeCloseTo(235); expect(point.y).toBeCloseTo(380);
    expect(open).not.toHaveBeenCalled();
    drive('tap', 'end', point);
    expect(open).toHaveBeenCalledWith('one');
  });
  it('keeps random photo opening at overview and ignores empty space while close', () => {
    mount();
    drive('tap', 'end', { x: 20, y: 20 });
    expect(open).toHaveBeenCalledWith();
    open.mockClear();
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    drive('tap', 'end', { x: 20, y: 20 });
    expect(open).not.toHaveBeenCalled();
  });
  it('does not invent stars or enable gestures for an empty album', () => {
    mount([]);
    expect(state.enabled.pan).toBe(false); expect(state.enabled.pinch).toBe(false);
    expect(screen.queryByTestId('photo-sky-date')).toBeNull();
  });
  it('offers next/previous/overview/activation through actual native action callbacks', () => {
    mount([...moments, { id: 'two', occurredAt: '2026-06-01T12:00:00Z', authorRole: 'you' }]);
    const action = (name: string) => act(() => {
      // Bridge the native synthetic event; these tests assert callbacks, not VoiceOver speech.
      state.props?.onAccessibilityAction?.({ nativeEvent: { actionName: name } } as RN.AccessibilityActionEvent);
      flush();
    });
    action('nextPhoto'); expect(screen.getByTestId('photo-sky-date').textContent).toContain('May 12, 2026');
    action('activate'); expect(open).toHaveBeenCalledWith('one');
    action('nextPhoto'); expect(screen.getByTestId('photo-sky-date').textContent).toContain('Jun 1, 2026');
    action('previousPhoto'); expect(screen.getByTestId('photo-sky-date').textContent).toContain('May 12, 2026');
    action('resetView'); expect(state.camera?.value).toEqual(PHOTO_SKY_OVERVIEW);
    expect(screen.queryByTestId('photo-sky-date')).toBeNull();
  });
  it('provides scoped keyboard zoom, traversal, photo activation, and reset', () => {
    Object.defineProperty(RN.Platform, 'OS', { value: 'web', configurable: true });
    mount();
    const field = screen.getByLabelText('Photo sky');
    act(() => { fireEvent.keyDown(field, { key: ']' }); flush(); });
    expect(state.camera?.value.zoom).toBe(7);
    act(() => { fireEvent.keyDown(field, { key: 'ArrowRight' }); flush(); });
    act(() => { fireEvent.keyDown(field, { key: 'Enter' }); });
    expect(open).toHaveBeenCalledWith('one');
    act(() => { fireEvent.keyDown(field, { key: 'Home' }); flush(); });
    expect(screen.queryByTestId('photo-sky-date')).toBeNull();
  });
  it('keeps reduced-motion traversal direct, without release momentum', () => {
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    mount();
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    drive('pan', 'start', { x: 195, y: 350 });
    drive('pan', 'update', { translationX: 10, translationY: 10 });
    const held = { ...state.camera!.value };
    drive('pan', 'end', { velocityX: 500, velocityY: 500 });
    expect(state.camera?.value).toEqual(held);
  });
});
