import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Radii } from '@/constants/theme';
import type { GalleryPhoto } from '@/features/moments/gallery';

let imageProps: any = null;
let measured = true;

vi.mock('expo-image', () => ({
  Image: (props: any) => {
    imageProps = props;
    return null;
  },
}));

vi.mock('@/features/composer/staged-uri', () => ({
  resolveStagedUri: (uri: string) => `resolved:${uri}`,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
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

describe('GalleryTile', () => {
  it('reports the frame it was tapped on, so the viewer morphs out of it', async () => {
    measured = true;
    const onPress = vi.fn();
    const { GalleryTile } = await import('@/components/moments/gallery-tile');
    render(
      createElement(GalleryTile, {
        photo,
        size: 96,
        accessibilityLabel: 'Open photo 1 of 4 from March 2026',
        onPress,
      }),
    );
    fireEvent.click(screen.getByLabelText('Open photo 1 of 4 from March 2026'));
    // The radius the viewer starts from is the tile's own, not a guess.
    expect(onPress).toHaveBeenCalledWith(photo, {
      x: 12,
      y: 24,
      width: 96,
      height: 96,
      radius: Radii.sm,
    });
  });

  it('opens without a morph when the node cannot be measured', async () => {
    measured = false;
    const onPress = vi.fn();
    const { GalleryTile } = await import('@/components/moments/gallery-tile');
    render(
      createElement(GalleryTile, {
        photo,
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
    const { GalleryTile } = await import('@/components/moments/gallery-tile');
    render(
      createElement(GalleryTile, {
        photo,
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
