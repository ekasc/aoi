import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ViewerVoicePageProps } from '@/components/moments/viewer-media-page';

let sampleListener: ((sample: any) => void) | null = null;
let videoSurfaceProps: any = null;
const player = {
  isAudioSamplingSupported: true,
  setAudioSamplingEnabled: vi.fn(),
};

vi.mock('expo-audio', () => ({
  // The real hook only listens; the test fires the samples itself.
  useAudioSampleListener: (_player: unknown, listener: (sample: any) => void) => {
    sampleListener = listener;
  },
}));

vi.mock('@/hooks/use-voice-playback', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useVoicePlayback: () => ({
      player,
      isPlaying: true,
      progress: 0.5,
      seconds: 3,
      toggle: vi.fn(),
    }),
  };
});

vi.mock('@/components/media/video-player', () => ({
  VideoSurface: (props: any) => {
    videoSurfaceProps = props;
    return createElement('div', { 'data-testid': 'video-surface' });
  },
}));

vi.mock('expo-image', () => ({
  Image: () => createElement('div', { 'data-testid': 'still' }),
}));

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

let waveProps: any = null;

vi.mock('@/components/media/live-waveform', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    LiveWaveform: (props: any) => {
      waveProps = props;
      return createElement('div', { 'data-testid': 'wave' });
    },
  };
});

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => createElement('span', {}, children),
}));

vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#000000' }));

vi.mock('@/features/composer/staged-uri', () => ({
  resolveStagedUri: (uri: string) => `resolved:${uri}`,
}));

const capturedStyleFns: (() => any)[] = [];

// The shared Reanimated mock drops animated styles; this test needs them, so
// it evaluates the callback the way the UI thread would and keeps the result.
vi.mock('react-native-reanimated', () => {
  const React = require('react');
  const View = ({ children, style, ...rest }: any) =>
    React.createElement('div', { style, ...rest }, children);
  // expo-image and expo-video wrap their views through these.
  const createAnimatedComponent = (Component: any) => Component;
  return {
    __esModule: true,
    default: { View, createAnimatedComponent },
    Animated: { View, createAnimatedComponent },
    useSharedValue: (initial: any) =>
      React.useRef({ value: typeof initial === 'function' ? initial() : initial }).current,
    useAnimatedStyle: (fn: () => any) => {
      // Keep the worklet itself: a bar only re-reads its shared value on the
      // UI thread, so evaluating the function later is what the device does.
      capturedStyleFns.push(fn);
      return fn();
    },
    useReducedMotion: () => false,
    Easing: { bezier: () => ({}), cubic: {}, in: (v: any) => v, linear: {}, out: (v: any) => v },
    withTiming: (value: any) => value,
    withRepeat: (value: any) => value,
  };
});

vi.mock('react-native', () => {
  const React = require('react');
  const View = ({ children, style, onLayout, ...rest }: any) => {
    // Measure on mount: the waveform sizes itself from its own width.
    React.useEffect(() => {
      onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 128 } } });
    }, [onLayout]);
    return React.createElement('div', { style, ...rest }, children);
  };
  const Pressable = ({ children, style, onPress, ...rest }: any) =>
    React.createElement(
      'div',
      {
        ...(typeof rest.accessibilityLabel === 'string' ? { 'aria-label': rest.accessibilityLabel } : {}),
        ...(onPress ? { onClick: onPress } : {}),
        style,
      },
      children,
    );
  return {
    View,
    Pressable,
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
  };
});

/**
 * The scale each bar is drawn at. Read from the animated styles themselves:
 * jsdom serializes a transform array as "[object Object]", so the DOM cannot
 * tell the truth about it.
 */
function barScales(): number[] {
  return capturedStyleFns
    .map((worklet) => worklet()?.transform?.[0]?.scaleY)
    .filter((scale): scale is number => typeof scale === 'number');
}

/** Shared values, as plain objects: the worklets only read `.value`. */
function shared(value: number) {
  return { value } as any;
}

const morph = {
  t: shared(0),
  residualX: shared(0),
  residualY: shared(0),
  sourceWidth: shared(0),
  sourceHeight: shared(0),
  overlay: shared(1),
} as any;

const home = {
  x: shared(0),
  y: shared(0),
  width: shared(0),
  height: shared(0),
  radius: shared(0),
  valid: { value: false } as any,
} as any;

const voiceProps: ViewerVoicePageProps = {
  uri: 'file:///note.m4a',
  label: '3 of 5 from March 2026',
  seed: 'm:audio',
  width: 390,
  height: 844,
  active: true,
  morph,
  home,
};

describe('ViewerVoicePage waveform', () => {
  beforeEach(() => {
    sampleListener = null;
    videoSurfaceProps = null;
    capturedStyleFns.length = 0;
    player.setAudioSamplingEnabled.mockClear();
  });

  it('sizes the wave to the width it was given, not a fixed strip', async () => {
    const { ViewerVoicePage } = await import('@/components/moments/viewer-media-page');
    render(createElement(ViewerVoicePage, voiceProps));
    // A 390pt band of 3pt bars on 2pt gaps: 78 of them, on one canvas, sized
    // from the measured width rather than a fixed strip.
    expect(waveProps.columns).toBe(78);
    expect(waveProps.width).toBe(390);
    expect(waveProps.levels.value).toHaveLength(78);
  });

  it('hands the wave the levels the audio produced, not a shape of its own', async () => {
    const { ViewerVoicePage } = await import('@/components/moments/viewer-media-page');
    render(createElement(ViewerVoicePage, voiceProps));
    expect(waveProps.columns).toBe(78);
    expect(waveProps.levels.value).toHaveLength(78);

    await act(async () => {
      sampleListener?.({ timestamp: 0.5, channels: [{ frames: [0.9, 0.8, 0.9, 0.8] }] });
      // Levels are published once a frame, not per sample callback.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    // The same shared value the canvas draws from is the one the samples
    // land in, so nothing has to be copied into React state to be seen.
    expect(Math.max(...waveProps.levels.value)).toBeCloseTo(0.9, 2);
  });

  it('asks for sampling and gives it back', async () => {
    const { ViewerVoicePage } = await import('@/components/moments/viewer-media-page');
    const { unmount } = render(createElement(ViewerVoicePage, voiceProps));
    expect(player.setAudioSamplingEnabled).toHaveBeenCalledWith(true);
    unmount();
    expect(player.setAudioSamplingEnabled).toHaveBeenCalledWith(false);
  });

  it('keeps a note silent until its page is the one on screen', async () => {
    const { ViewerVoicePage } = await import('@/components/moments/viewer-media-page');
    render(createElement(ViewerVoicePage, { ...voiceProps, active: false }));
    expect(sampleListener).toBeNull();
    expect(player.setAudioSamplingEnabled).not.toHaveBeenCalled();
  });
});

describe('ViewerVideoPage', () => {
  beforeEach(() => {
    videoSurfaceProps = null;
    capturedStyleFns.length = 0;
  });

  it('does not start a clip just because the page opened on it', async () => {
    const { ViewerVideoPage } = await import('@/components/moments/viewer-media-page');
    const { rerender } = render(
      createElement(ViewerVideoPage, {
        uri: 'https://cdn.test/clip.mp4',
        posterUri: 'file:///poster.jpg',
        label: 'Beach dog',
        width: 390,
        height: 844,
        active: true,
        morph,
        home,
      }),
    );
    // The still and a play control: the reader asked to look, not to listen.
    expect(videoSurfaceProps).toBeNull();
    expect(screen.getByLabelText('Play video: Beach dog')).toBeTruthy();

    act(() => {
      screen.getByLabelText('Play video: Beach dog').click();
    });
    rerender(
      createElement(ViewerVideoPage, {
        uri: 'https://cdn.test/clip.mp4',
        posterUri: 'file:///poster.jpg',
        label: 'Beach dog',
        width: 390,
        height: 844,
        active: true,
        morph,
        home,
      }),
    );
    expect(videoSurfaceProps).toMatchObject({ uri: 'https://cdn.test/clip.mp4' });
  });

  it('keeps a clip on its still while its page is off screen', async () => {
    const { ViewerVideoPage } = await import('@/components/moments/viewer-media-page');
    render(
      createElement(ViewerVideoPage, {
        uri: 'https://cdn.test/clip.mp4',
        posterUri: 'file:///poster.jpg',
        label: 'Beach dog',
        width: 390,
        height: 844,
        active: false,
        morph,
        home,
      }),
    );
    expect(videoSurfaceProps).toBeNull();
    expect(screen.queryByLabelText('Play video: Beach dog')).toBeNull();
  });
});
