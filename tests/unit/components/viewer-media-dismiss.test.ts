import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DISMISS_PROGRESS, DISMISS_VELOCITY, shouldDismissOnRelease } from '@/components/moments/zoomable-photo';

const SOURCE = readFileSync('components/moments/viewer-media-dismiss.ts', 'utf8');
const PHOTO_SOURCE = readFileSync('components/moments/zoomable-photo.tsx', 'utf8');

describe('shouldDismissOnRelease', () => {
  it('closes once the pull is past the distance that means it', () => {
    expect(shouldDismissOnRelease(DISMISS_PROGRESS, 0)).toBe(true);
    expect(shouldDismissOnRelease(DISMISS_PROGRESS - 0.01, 0)).toBe(false);
  });

  it('closes on a fling even from a short pull', () => {
    expect(shouldDismissOnRelease(0.05, DISMISS_VELOCITY + 1)).toBe(true);
    expect(shouldDismissOnRelease(0.05, DISMISS_VELOCITY - 1)).toBe(false);
  });
});

describe('media dismiss contracts (source)', () => {
  it('is one decision shared with the photo viewer, not a second copy', () => {
    // Both pages ask the same function, so a tune of the threshold moves
    // every page at once.
    expect(SOURCE).toContain('shouldDismissOnRelease(t, speed)');
    expect(PHOTO_SOURCE).toContain('shouldDismissOnRelease(t, speed)');
  });

  it('leaves horizontal travel to the pager', () => {
    expect(SOURCE).toContain('.failOffsetX([-24, 24])');
  });

  it('closes when the animation lands, and hands touches back before it', () => {
    expect(SOURCE).toContain('runOnJS(onDismissStart)();');
    expect(SOURCE).toMatch(/withSpring\(\s*1,\s*\{ \.\.\.CLOSE_SPRING/);
    expect(SOURCE).toContain('if (finished) {\n                runOnJS(onClose)();');
  });

  it('never leaves a page parked away from fullscreen', () => {
    // A cancelled pull (a call, a system gesture) must settle back.
    expect(SOURCE).toContain('.onFinalize((_, success) => {');
    expect(SOURCE).toContain('morph.t.value = reduceMotion ? 0 : withSpring(0, DRAG_SPRING);');
  });

  it('respects reduced motion by taking the end state, not an animation', () => {
    expect(SOURCE).toContain('morph.t.value = reduceMotion ? 0 : withSpring(0, DRAG_SPRING);');
    expect(SOURCE).toContain('morph.t.value = withSpring(1, CLOSE_SPRING, (finished) => {');
  });

  it('owns the reduced-motion close without a spring', () => {
    expect(SOURCE).toMatch(/if \(reduceMotion\) \{\s*morph\.t\.value = 1;\s*onClose\(\);/);
  });
});

describe('voice scrub contracts (source)', () => {
  const VOICE_SOURCE = readFileSync('components/moments/viewer-media-page.tsx', 'utf8');

  it('scrubs on the wave band only: horizontal scrubs, vertical dismisses', () => {
    expect(VOICE_SOURCE).toContain('.activeOffsetX([-6, 6])');
    expect(VOICE_SOURCE).toContain('.failOffsetY([-18, 18])');
  });

  it('seeks to where the finger is, and pauses the note while it drags', () => {
    expect(VOICE_SOURCE).toContain('scrubSecondsForOffset(offsetX, waveWidth, duration)');
    expect(VOICE_SOURCE).toContain('runOnJS(scrubTo)(event.x, true)');
    expect(VOICE_SOURCE).toContain('runOnJS(beginScrub)()');
    expect(VOICE_SOURCE).toContain('runOnJS(finishScrub)(success)');
  });

  it('follows the finger on the UI thread, through one value', () => {
    expect(VOICE_SOURCE).toContain('playhead.value = scrubFractionForOffset(event.x, waveWidth)');
    // One waveform, and the playhead is the same value the wave draws with:
    // no second copy, no clipping box whose width would animate layout.
    expect(VOICE_SOURCE.match(/<LiveWaveform/g)).toHaveLength(1);
    expect(VOICE_SOURCE).toContain('progress={playhead}');
    expect(VOICE_SOURCE).not.toContain('playedClip');
  });

  it('draws the wave on one canvas rather than one view per bar', () => {
    const WAVE_SOURCE = readFileSync('components/media/live-waveform.tsx', 'utf8');
    expect(WAVE_SOURCE).toContain("from '@shopify/react-native-skia'");
    expect(WAVE_SOURCE).toContain('useDerivedValue');
    // One path for the whole wave: 71 animated views meant 71 native prop
    // updates per sample callback, which is what made it janky.
    expect(WAVE_SOURCE.match(/addRRect/g)).toHaveLength(1);
    expect(WAVE_SOURCE).not.toContain('Animated.View');
  });

  it('paces native seeks at finger speed and always lands the last one', () => {
    // A native seek behind every pan update is what stutters a scrub.
    expect(VOICE_SOURCE).toContain('now - lastSeek.current >= SCRUB_SEEK_INTERVAL_MS');
    expect(VOICE_SOURCE).toContain('runOnJS(scrubTo)(event.x, false)');
    expect(VOICE_SOURCE).toContain('runOnJS(scrubTo)(event.x, true)');
  });

  it('never touches the player after the page is gone', () => {
    expect(VOICE_SOURCE).toContain('if (!live.current) {');
    expect(VOICE_SOURCE).toContain('live.current = false;');
  });
});
