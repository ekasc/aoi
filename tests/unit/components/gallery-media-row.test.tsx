import { readFileSync } from 'node:fs';

import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GalleryItem } from '@/features/moments/gallery';

let videoProps: any = null;
let audioProps: any = null;

vi.mock('@/components/media/video-player', () => ({
  VideoPlayer: (props: any) => {
    videoProps = props;
    return null;
  },
}));

vi.mock('@/components/media/audio-player', () => ({
  AudioPlayer: (props: any) => {
    audioProps = props;
    return null;
  },
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: any) => createElement('div', {}, children),
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => createElement('span', {}, children),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('react-native', () => {
  const React = require('react');
  const View = ({ children }: any) => React.createElement('div', {}, children);
  return {
    View,
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
  };
});

function item(overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    key: 'm:video',
    kind: 'video',
    momentId: 'm',
    mediaId: 'media-1',
    uri: 'https://cdn.test/clip.mp4',
    posterUri: 'file:///poster.jpg',
    title: 'Beach dog',
    occurredAt: '2026-03-15T10:00:00.000Z',
    authorRole: 'partner',
    authorName: 'June',
    ...overrides,
  };
}

describe('GalleryMediaRow', () => {
  beforeEach(() => {
    videoProps = null;
    audioProps = null;
  });

  it('prints kind, date and who kept it, then the memory title', async () => {
    const { GalleryMediaRow } = await import('@/components/moments/gallery-media-row');
    render(createElement(GalleryMediaRow, { item: item(), sectionLabel: 'March 2026' }));
    expect(screen.getByText('Video · Mar 15 · June')).toBeTruthy();
    expect(screen.getByText('Beach dog')).toBeTruthy();
  });

  it('hands the video its still and a label that names the memory', async () => {
    const { GalleryMediaRow } = await import('@/components/moments/gallery-media-row');
    render(createElement(GalleryMediaRow, { item: item(), sectionLabel: 'March 2026' }));
    expect(videoProps).toMatchObject({
      uri: 'https://cdn.test/clip.mp4',
      posterUri: 'file:///poster.jpg',
      aspectRatio: 16 / 9,
    });
    expect(videoProps.label).toContain('Beach dog');
    expect(videoProps.label).toContain('March 2026');
  });

  it('gives a voice note the labelled player, on its own line of the album', async () => {
    const { GalleryMediaRow } = await import('@/components/moments/gallery-media-row');
    render(
      createElement(GalleryMediaRow, {
        item: item({ kind: 'voice', uri: 'file:///v.m4a', posterUri: null, title: '' }),
        sectionLabel: 'March 2026',
      }),
    );
    expect(screen.getByText('Voice · Mar 15 · June')).toBeTruthy();
    expect(audioProps.uri).toBe('file:///v.m4a');
    // No title: the label falls back to when and where, never "video".
    expect(audioProps.label).toBe('Mar 15, March 2026');
    expect(videoProps).toBeNull();
  });

  it('keeps its own layout contract in source', () => {
    // A media row is full width, and the paddings keep the album rhythm.
    const source = readFileSync('components/moments/gallery-media-row.tsx', 'utf8');
    expect(source).toContain('paddingHorizontal: Spacing[24]');
    expect(source).toContain('aspectRatio={16 / 9}');
  });
});
