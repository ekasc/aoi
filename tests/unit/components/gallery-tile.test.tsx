import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { GALLERY_TILE_RADIUS } from '@/components/moments/gallery-tile';
import type { GalleryItem, GalleryPhoto } from '@/features/moments/gallery';

let imageProps: any = null;
let measured = true;
let videoSurfaceProps: any = null;
const playback = { isPlaying: false, progress: 0.5, seconds: 12, toggle: vi.fn() };

vi.mock('expo-image', () => ({
  Image: (props: any) => {
    imageProps = props;
    return null;
  },
}));

vi.mock('@/components/media/video-player', () => ({
  VideoSurface: (props: any) => {
    videoSurfaceProps = props;
    return null;
  },
}));

vi.mock('@/hooks/use-voice-playback', () => ({
  useVoicePlayback: () => playback,
  formatPlaybackSeconds: (value: number) => `${value}`,
}));

vi.mock('@/features/composer/staged-uri', () => ({
  resolveStagedUri: (uri: string) => `resolved:${uri}`,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

vi.mock('react-native', () => {
  const React = require('react');
  const View = ({ children }: any) => React.createElement('div', {}, children);
  const Pressable = React.forwardRef(({ children, onPress, ...rest }: any, ref: any) => {
    React.useImperativeHandle(ref, () =>
      measured ? { measureInWindow: (cb: any) => cb(12, 24, 96, 96) } : {},
    );
    return React.createElement(
      'div',
      {
        ...(typeof rest.accessibilityLabel === 'string'
          ? { 'aria-label': rest.accessibilityLabel }
          : {}),
        ...(rest.accessibilityHint ? { 'aria-description': rest.accessibilityHint } : {}),
        ...(onPress ? { onClick: onPress } : {}),
      },
      children,
    );
  });
  return {
    View,
    Pressable,
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
  };
});

const photo: GalleryPhoto = {
  key: 'm:p1',
  kind: 'photo',
  momentId: 'm',
  mediaId: 'p1',
  uri: 'composer/v/s/staged/staged_p1.jpg',
  posterUri: null,
  title: 'Lake day',
  occurredAt: '2026-03-15T10:00:00.000Z',
  authorRole: 'you',
  authorName: 'Maya',
};

const video: GalleryItem = {
  ...photo,
  key: 'm:video',
  kind: 'video',
  uri: 'https://cdn.test/clip.mp4',
  posterUri: 'file:///poster.jpg',
};

const voice: GalleryItem = {
  ...photo,
  key: 'm:audio',
  kind: 'voice',
  uri: 'composer/v/s/staged/staged_v.m4a',
  posterUri: null,
};

describe('GalleryPhotoTile', () => {
  it('reports the frame it was tapped on, so the viewer morphs out of it', async () => {
    measured = true;
    const onPress = vi.fn();
    const { GalleryPhotoTile } = await import('@/components/moments/gallery-tile');
    render(
      createElement(GalleryPhotoTile, {
        item: photo,
        size: 96,
        accessibilityLabel: 'Open photo 1 of 4 from March 2026',
        onPress,
      }),
    );
    fireEvent.click(screen.getByLabelText('Open photo 1 of 4 from March 2026'));
    // Square, chrome-free tiles: the viewer starts from radius 0 like the tile.
    expect(GALLERY_TILE_RADIUS).toBe(0);
    expect(onPress).toHaveBeenCalledWith(photo, {
      x: 12,
      y: 24,
      width: 96,
      height: 96,
      radius: 0,
    });
  });

  it('opens without a morph when the node cannot be measured', async () => {
    measured = false;
    const onPress = vi.fn();
    const { GalleryPhotoTile } = await import('@/components/moments/gallery-tile');
    render(
      createElement(GalleryPhotoTile, {
        item: photo,
        size: 96,
        accessibilityLabel: 'Open photo 1 of 4 from March 2026',
        onPress,
      }),
    );
    fireEvent.click(screen.getByLabelText('Open photo 1 of 4 from March 2026'));
    expect(onPress).toHaveBeenCalledWith(photo);
  });

  it('resolves the staged path and keys the image so a recycled tile never lies', async () => {
    measured = true;
    const { GalleryPhotoTile } = await import('@/components/moments/gallery-tile');
    render(
      createElement(GalleryPhotoTile, {
        item: photo,
        size: 96,
        accessibilityLabel: 'Open photo 1 of 4 from March 2026',
        onPress: vi.fn(),
      }),
    );
    expect(imageProps.source).toEqual({ uri: 'resolved:composer/v/s/staged/staged_p1.jpg' });
    expect(imageProps.recyclingKey).toBe('m:p1');
    // Decorative: the tile's own label already names the photo.
    expect(imageProps.accessible).toBe(false);
  });
});

describe('GalleryVideoTile', () => {
  it('shows the still with a play badge, and only builds a player once asked', async () => {
    videoSurfaceProps = null;
    const { GalleryVideoTile } = await import('@/components/moments/gallery-tile');
    render(
      createElement(GalleryVideoTile, {
        item: video,
        size: 96,
        label: 'Beach dog (2 of 5 from March 2026)',
      }),
    );
    expect(imageProps.source).toEqual({ uri: 'resolved:file:///poster.jpg' });
    expect(imageProps.recyclingKey).toBe('m:video');
    expect(videoSurfaceProps).toBeNull();

    fireEvent.click(screen.getByLabelText('Play video: Beach dog (2 of 5 from March 2026)'));
    // The clip plays where it sits: cover-fit in the square, native controls.
    expect(videoSurfaceProps).toMatchObject({ uri: 'https://cdn.test/clip.mp4', contentFit: 'cover' });
    expect(screen.queryByLabelText('Play video: Beach dog (2 of 5 from March 2026)')).toBeNull();
  });
});

describe('GalleryVoiceTile', () => {
  it('plays in place: the waveform is the control, and it carries progress', async () => {
    playback.isPlaying = false;
    playback.toggle.mockClear();
    imageProps = null;
    const { GalleryVoiceTile } = await import('@/components/moments/gallery-tile');
    render(
      createElement(GalleryVoiceTile, {
        item: voice,
        size: 96,
        label: '3 of 5 from March 2026',
      }),
    );
    // Nothing to show: a voice print has no still, so the waveform is the tile.
    expect(imageProps).toBeNull();
    fireEvent.click(screen.getByLabelText('Play voice note: 3 of 5 from March 2026'));
    expect(playback.toggle).toHaveBeenCalledTimes(1);
  });

  it('announces pause while it is playing', async () => {
    playback.isPlaying = true;
    const { GalleryVoiceTile } = await import('@/components/moments/gallery-tile');
    render(
      createElement(GalleryVoiceTile, {
        item: voice,
        size: 96,
        accessibilityLabel: 'Play voice note 3 of 5 from March 2026',
        label: '3 of 5 from March 2026',
      }),
    );
    expect(screen.getByLabelText('Pause voice note: 3 of 5 from March 2026')).toBeTruthy();
    playback.isPlaying = false;
  });
});
