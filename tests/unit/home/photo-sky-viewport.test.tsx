import { act, fireEvent, render, screen } from '@testing-library/react';
import * as RN from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PhotoSkyViewport } from '@/components/home/photo-sky-viewport';
import type { SkyItem } from '@/features/home/day-sky';
import { photoSkyStar } from '@/features/home/photo-sky';
import { PHOTO_SKY_OVERVIEW, focusPhotoSkyStar, projectPhotoSkyStar, type PhotoSkyCamera } from '@/features/home/photo-sky-camera';

type Handler = (event: Record<string, number>, success?: boolean) => void;
const state = vi.hoisted(() => ({ handlers: {} as Record<string, Record<string, Handler>>, enabled: {} as Record<string, boolean>, tapOrder: [] as string[], buttons: {} as Record<string, RN.PressableProps>, camera: null as { value: PhotoSkyCamera } | null, props: null as RN.ViewProps | null,
  frame: null as ((info: Reanimated.FrameInfo) => void) | null, frameActive: vi.fn(),
}));
vi.mock('react-native-gesture-handler', () => {
  const gesture = (initial: string) => {
    let name = initial;
    state.handlers[name] = {};
    const chain = {
      get kind() { return name; },
      enabled(value: boolean) { state.enabled[name] = value; return chain; },
      maxPointers() { return chain; }, minDistance() { return chain; }, maxDistance() { return chain; }, maxDelay() { return chain; }, maxDuration() { return chain; },
      minPointers(value: number) { if (value === 2) { name = 'twoFingerTap'; state.handlers[name] = {}; } return chain; },
      numberOfTaps() { name = 'doubleTap'; state.handlers[name] = {}; return chain; },
      onBegin(fn: Handler) { state.handlers[name].begin = fn; return chain; },
      onStart(fn: Handler) { state.handlers[name].start = fn; return chain; },
      onUpdate(fn: Handler) { state.handlers[name].update = fn; return chain; },
      onEnd(fn: Handler) { state.handlers[name].end = fn; return chain; },
      onFinalize(fn: Handler) { state.handlers[name].finalize = fn; return chain; },
    };
    return chain;
  };
  return {
    Gesture: { Pan: () => gesture('pan'), Pinch: () => gesture('pinch'), Tap: () => gesture('tap'), Simultaneous: () => ({}), Race: () => ({}), Exclusive: (...gestures: { kind: string }[]) => { state.tapOrder = gestures.map((item) => item.kind); return {}; } },
    GestureDetector: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});
vi.mock('@/components/home/memory-sky', () => ({ MemorySky: ({ photoCamera }: { photoCamera: { value: PhotoSkyCamera } }) => { state.camera = photoCamera; return <div data-testid="rendered-sky" />; } }));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#444444' }));
const HostView = RN.View;
const HostPressable = RN.Pressable;
const originalOS = RN.Platform.OS;
const moments: SkyItem[] = [{ id: 'one', occurredAt: '2026-05-12T12:00:00Z', authorRole: 'you' }];
const viewport = { width: 390, height: 700 };
const flush = () => (globalThis as unknown as { __flushReactions: () => void }).__flushReactions();
const drive = (kind: string, action: string, event: Record<string, number>, success = true) => act(() => {
  const defaults = kind === 'pinch' ? { numberOfPointers: 2 } : kind === 'pan' ? { numberOfPointers: 1, translationX: 0, translationY: 0 } : {};
  state.handlers[kind][action]({ ...defaults, ...event }, success);
  flush();
});
const open = vi.fn();
const mount = (photos = moments) => render(<PhotoSkyViewport moments={photos} height={700} controlsBottom={0} now={new Date()} focused canOpen={photos.length > 0} onOpenPhoto={open} />);
const pressControl = (label: string) => act(() => { fireEvent.click(screen.getByLabelText(label)); flush(); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Reanimated, 'useFrameCallback').mockImplementation((callback) => {
    state.frame = callback;
    return { setActive: state.frameActive, isActive: false, callbackId: 1 };
  });
  state.handlers = {}; state.enabled = {}; state.buttons = {}; state.props = null; state.camera = null;
  vi.spyOn(RN, 'View').mockImplementation((props) => { if (props.testID === 'photo-sky-viewport') state.props = props; return <HostView {...props} />; });
  vi.spyOn(RN, 'Pressable').mockImplementation((props) => {
    if (props.accessibilityLabel) state.buttons[props.accessibilityLabel] = props;
    return <HostPressable {...props} />;
  });
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
  it('double-taps again to return to overview without opening a photo', () => {
    mount();
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    drive('doubleTap', 'end', { x: 195, y: 350 });
    expect(state.camera?.value).toEqual(PHOTO_SKY_OVERVIEW);
    expect(screen.queryByTestId('photo-sky-controls')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
  it('prioritizes two-finger tap and zooms out one step without opening a photo', () => {
    mount();
    expect(state.tapOrder).toEqual(['twoFingerTap', 'doubleTap', 'tap']);
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    drive('twoFingerTap', 'end', { x: 195, y: 350 });
    expect(state.camera!.value.zoom).toBeCloseTo(7 / 1.5);
    const held = { ...state.camera!.value };
    drive('twoFingerTap', 'end', { x: 195, y: 350 }, false);
    expect(state.camera?.value).toEqual(held);
    expect(open).not.toHaveBeenCalled();
  });
  it('offers named close-up zoom and reset controls, with a disabled maximum', () => {
    mount();
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    expect(screen.getByTestId('photo-sky-controls')).toBeTruthy();
    expect(screen.queryByLabelText('Next photo star')).toBeNull();
    for (const label of ['Zoom in', 'Zoom out', 'Show the whole sky']) {
      expect(state.buttons[label].accessibilityRole).toBe('button');
      expect(screen.getByLabelText(label).style.minHeight).toBe('44px');
      expect(screen.getByLabelText(label).style.minWidth).toBe('44px');
    }
    pressControl('Zoom in');
    pressControl('Zoom in');
    expect(state.camera!.value.zoom).toBe(12);
    // The RN test adapter does not expose disabled state as ARIA; inspect native props.
    expect(state.buttons['Zoom in'].disabled).toBe(true);
    expect(state.buttons['Zoom in'].accessibilityState?.disabled).toBe(true);
    pressControl('Zoom out');
    expect(state.camera!.value.zoom).toBe(8);
    pressControl('Show the whole sky');
    expect(state.camera?.value).toEqual(PHOTO_SKY_OVERVIEW);
    expect(screen.queryByTestId('photo-sky-controls')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
  it('uses explicit next and previous controls to traverse photos and wrap at the ends', () => {
    mount([...moments, { id: 'two', occurredAt: '2026-06-01T12:00:00Z', authorRole: 'you' }]);
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    pressControl('Next photo star');
    expect(screen.getByTestId('photo-sky-date').textContent).toContain('Jun 1, 2026');
    pressControl('Next photo star');
    expect(screen.getByTestId('photo-sky-date').textContent).toContain('May 12, 2026');
    pressControl('Previous photo star');
    expect(screen.getByTestId('photo-sky-date').textContent).toContain('Jun 1, 2026');
    expect(open).not.toHaveBeenCalled();
  });
  it('keeps reset available below the date threshold and removes controls at overview', () => {
    mount();
    drive('pinch', 'start', { focalX: 195, focalY: 350 });
    drive('pinch', 'update', { focalX: 195, focalY: 350, scale: 2 });
    expect(screen.queryByTestId('photo-sky-date')).toBeNull();
    expect(screen.getByLabelText('Show the whole sky')).toBeTruthy();
    drive('twoFingerTap', 'end', { x: 195, y: 350 });
    drive('twoFingerTap', 'end', { x: 195, y: 350 });
    expect(state.camera?.value).toEqual(PHOTO_SKY_OVERVIEW);
    expect(screen.queryByTestId('photo-sky-controls')).toBeNull();
  });
  it('pinches around the moving focal point and hides dates again at overview', () => {
    mount();
    const point = projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport);
    drive('pinch', 'start', { focalX: point.x, focalY: point.y });
    drive('pinch', 'update', { focalX: 195, focalY: 350, scale: 12 });
    expect(state.camera!.value.zoom).toBeGreaterThan(4);
    expect(state.camera!.value.zoom).toBeLessThan(12);
    expect(screen.getByTestId('photo-sky-date')).toBeTruthy();
    drive('pinch', 'finalize', {});
    drive('pinch', 'start', { focalX: 195, focalY: 350 });
    drive('pinch', 'update', { focalX: 195, focalY: 350, scale: 0.01 });
    expect(state.camera?.value).toEqual(PHOTO_SKY_OVERVIEW);
    expect(screen.queryByTestId('photo-sky-date')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
  it('holds the last two-finger camera when one finger lifts and the focal point jumps', () => {
    mount();
    drive('pinch', 'start', { focalX: 195, focalY: 350 });
    drive('pinch', 'update', { focalX: 195, focalY: 350, scale: 2 });
    const held = { ...state.camera!.value };
    const point = projectPhotoSkyStar(photoSkyStar('one'), held, viewport);
    drive('pinch', 'update', { focalX: 90, focalY: 600, scale: 2, numberOfPointers: 1 });
    expect(state.camera?.value).toEqual(held);
    drive('pinch', 'finalize', {});
    expect(projectPhotoSkyStar(photoSkyStar('one'), state.camera!.value, viewport)).toEqual(point);
  });
  it('lets pinch own the camera instead of simultaneous pan updates or cancellation momentum', () => {
    mount();
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    drive('pan', 'start', { x: 195, y: 350 });
    drive('pinch', 'start', { focalX: 195, focalY: 350 });
    drive('pinch', 'update', { focalX: 210, focalY: 360, scale: 1.2 });
    const held = { ...state.camera!.value };
    drive('pan', 'update', { translationX: 100, translationY: 80, numberOfPointers: 2 });
    expect(state.camera?.value).toEqual(held);
    drive('pan', 'end', { velocityX: 1000, velocityY: 800 }, false);
    expect(state.camera?.value).toEqual(held);
    drive('pan', 'finalize', {});
    drive('pinch', 'update', { focalX: 210, focalY: 360, scale: 1.3 });
    expect(state.camera?.value.zoom).toBeGreaterThan(held.zoom);
  });
  it('does not resume the old pan when a single finger remains after pinch', () => {
    mount();
    drive('pan', 'start', { x: 195, y: 350 });
    drive('pinch', 'start', { focalX: 195, focalY: 350 });
    drive('pinch', 'update', { focalX: 195, focalY: 350, scale: 2 });
    drive('pinch', 'finalize', {});
    const held = { ...state.camera!.value };
    drive('pan', 'update', { translationX: 100, translationY: 80 });
    drive('pan', 'end', { velocityX: 1000, velocityY: 800 });
    expect(state.camera?.value).toEqual(held);
  });
  it('retires an active pan when a second finger arrives before pinch activation', () => {
    mount();
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    drive('pan', 'start', { x: 195, y: 350 });
    drive('pan', 'update', { translationX: 10, translationY: 10 });
    const held = { ...state.camera!.value };
    drive('pan', 'update', { translationX: 20, translationY: 20, numberOfPointers: 2 });
    drive('pan', 'update', { translationX: 40, translationY: 40 });
    expect(state.camera?.value).toEqual(held);
  });
  it('does not apply momentum when native pan ends unsuccessfully', () => {
    mount();
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    drive('pan', 'start', { x: 195, y: 350 });
    drive('pan', 'update', { translationX: 10, translationY: 10 });
    const held = { ...state.camera!.value };
    drive('pan', 'end', { velocityX: 1000, velocityY: 800 }, false);
    drive('pan', 'finalize', {});
    expect(state.camera?.value).toEqual(held);
  });
  it('rebases a fresh pan on its activation translation instead of jumping by that distance', () => {
    mount();
    const star = photoSkyStar('one');
    drive('doubleTap', 'end', projectPhotoSkyStar(star, PHOTO_SKY_OVERVIEW, viewport));
    const held = { ...state.camera!.value };
    drive('pan', 'start', { x: 195, y: 350, translationX: 40, translationY: 30 });
    drive('pan', 'update', { translationX: 40, translationY: 30 });
    expect(state.camera?.value).toEqual(held);
    drive('pan', 'update', { translationX: 45, translationY: 35 });
    const point = projectPhotoSkyStar(star, state.camera!.value, viewport);
    expect(point.x).toBeCloseTo(200);
    expect(point.y).toBeCloseTo(355);
  });
  it('uses a gentler pinch response while preserving the focal anchor', () => {
    mount();
    const star = photoSkyStar('one');
    const point = projectPhotoSkyStar(star, PHOTO_SKY_OVERVIEW, viewport);
    drive('pinch', 'start', { focalX: point.x, focalY: point.y });
    drive('pinch', 'update', { focalX: point.x, focalY: point.y, scale: 2 });
    expect(state.camera!.value.zoom).toBeGreaterThan(1);
    expect(state.camera!.value.zoom).toBeLessThan(1.7);
    const projected = projectPhotoSkyStar(star, state.camera!.value, viewport);
    expect(projected.x).toBeCloseTo(point.x);
    expect(projected.y).toBeCloseTo(point.y);
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
  it('removes an inactive sky from keyboard navigation and exposes its disabled state', () => {
    render(<PhotoSkyViewport moments={moments} height={700} controlsBottom={0} now={new Date()} focused={false} canOpen onOpenPhoto={open} />);
    expect(screen.getByLabelText('Photo sky').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByLabelText('Photo sky').getAttribute('tabindex')).toBe('-1');
    expect(state.enabled.tap).toBe(false);
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
  it('uses a short cancellable transition for explicit focus and reset', () => {
    const timing = vi.spyOn(Reanimated, 'withTiming');
    mount();
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    expect(timing).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 7 }), expect.objectContaining({ duration: 280 }), expect.any(Function));
    pressControl('Show the whole sky');
    expect(timing).toHaveBeenLastCalledWith(PHOTO_SKY_OVERVIEW, expect.objectContaining({ duration: 280 }), expect.any(Function));
  });
  it('keeps the destination photo selected during travel instead of cycling through neighbours', () => {
    const timing = vi.spyOn(Reanimated, 'withTiming');
    mount([...moments, { id: 'two', occurredAt: '2026-06-01T12:00:00Z', authorRole: 'you' }]);
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    const finish = timing.mock.calls.at(-1)?.[2];
    act(() => { state.camera!.value = focusPhotoSkyStar(photoSkyStar('two')); flush(); });
    expect(screen.getByTestId('photo-sky-date').textContent).toContain('May 12, 2026');
    act(() => { finish?.(true); flush(); });
    expect(screen.getByTestId('photo-sky-date').textContent).toContain('Jun 1, 2026');
  });
  it('shows a decorative focus marker only while inspecting a real star', () => {
    mount();
    expect(screen.queryByTestId('photo-sky-focus')).toBeNull();
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    expect(screen.getByTestId('photo-sky-focus').getAttribute('aria-hidden')).toBe('true');
    pressControl('Show the whole sky');
    expect(screen.queryByTestId('photo-sky-focus')).toBeNull();
  });
  it('hands release momentum to a bounded frame loop and stops it on the next touch', () => {
    mount();
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    drive('pan', 'start', { x: 195, y: 350 });
    drive('pan', 'update', { translationX: 10, translationY: 10 });
    const held = { ...state.camera!.value };
    drive('pan', 'end', { velocityX: 400, velocityY: 200 });
    expect(state.camera?.value).toEqual(held);
    expect(state.frameActive).toHaveBeenLastCalledWith(true);
    act(() => { state.frame?.({ timestamp: 16, timeSinceFirstFrame: 16, timeSincePreviousFrame: 16 }); flush(); });
    expect(state.camera!.value.x).toBeLessThan(held.x);
    drive('pan', 'begin', {});
    const stopped = { ...state.camera!.value };
    expect(state.frameActive).toHaveBeenLastCalledWith(false);
    act(() => { state.frame?.({ timestamp: 32, timeSinceFirstFrame: 32, timeSincePreviousFrame: 16 }); flush(); });
    expect(state.camera?.value).toEqual(stopped);
  });
  it('stops the glide when the viewport loses focus and on unmount', () => {
    const tree = mount();
    drive('pan', 'start', { x: 195, y: 350 });
    drive('pan', 'end', { velocityX: 400, velocityY: 200 });
    expect(state.frameActive).toHaveBeenLastCalledWith(true);
    tree.rerender(<PhotoSkyViewport moments={moments} height={700} controlsBottom={0} now={new Date()} focused={false} canOpen onOpenPhoto={open} />);
    expect(state.frameActive).toHaveBeenLastCalledWith(false);
    const stopped = { ...state.camera!.value };
    act(() => { state.frame?.({ timestamp: 32, timeSinceFirstFrame: 32, timeSincePreviousFrame: 16 }); flush(); });
    expect(state.camera?.value).toEqual(stopped);
    tree.unmount();
    expect(state.frameActive).toHaveBeenLastCalledWith(false);
  });
  it('stops an active glide when the app is backgrounded', () => {
    let onChange: ((state: RN.AppStateStatus) => void) | undefined;
    vi.spyOn(RN.AppState, 'addEventListener').mockImplementation((_event, callback) => {
      onChange = callback;
      return { remove: vi.fn() };
    });
    mount();
    drive('pan', 'start', { x: 195, y: 350 });
    drive('pan', 'end', { velocityX: 400, velocityY: 200 });
    expect(state.frameActive).toHaveBeenLastCalledWith(true);
    act(() => onChange?.('background'));
    expect(state.frameActive).toHaveBeenLastCalledWith(false);
    const stopped = { ...state.camera!.value };
    act(() => { state.frame?.({ timestamp: 32, timeSinceFirstFrame: 32, timeSincePreviousFrame: 16 }); flush(); });
    expect(state.camera?.value).toEqual(stopped);
  });
  it('keeps reduced-motion traversal direct, without release momentum', () => {
    const timing = vi.spyOn(Reanimated, 'withTiming');
    vi.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    mount();
    drive('doubleTap', 'end', projectPhotoSkyStar(photoSkyStar('one'), PHOTO_SKY_OVERVIEW, viewport));
    drive('pan', 'start', { x: 195, y: 350 });
    drive('pan', 'update', { translationX: 10, translationY: 10 });
    const held = { ...state.camera!.value };
    drive('pan', 'end', { velocityX: 500, velocityY: 500 });
    expect(state.camera?.value).toEqual(held);
    expect(state.frameActive).not.toHaveBeenCalledWith(true);
    expect(timing).not.toHaveBeenCalled();
  });
});
