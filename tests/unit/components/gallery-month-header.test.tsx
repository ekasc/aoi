import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => createElement('span', {}, children),
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
  const Pressable = ({ children, onPress, accessibilityLabel, accessibilityRole }: any) =>
    React.createElement(
      'div',
      {
        ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
        ...(accessibilityRole ? { role: accessibilityRole } : {}),
        ...(onPress ? { onClick: onPress } : {}),
      },
      children,
    );
  return {
    View,
    Pressable,
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
  };
});

const photos = [
  {
    key: 'm:p1',
    kind: 'photo' as const,
    momentId: 'm',
    mediaId: 'p1',
    uri: 'https://cdn.test/p1',
    posterUri: null,
    title: '',
    occurredAt: '2026-03-15T10:00:00.000Z',
    authorRole: 'you' as const,
    authorName: 'Maya',
  },
  {
    key: 'm:v1',
    kind: 'voice' as const,
    momentId: 'm',
    mediaId: 'v1',
    uri: 'https://cdn.test/v1',
    posterUri: null,
    title: '',
    occurredAt: '2026-03-15T10:00:00.000Z',
    authorRole: 'you' as const,
    authorName: 'Maya',
  },
];

const marchSection = {
  id: 'month:2026-03',
  monthKey: '2026-03',
  label: 'March 2026',
  items: photos,
  counts: { photo: 1, video: 0, voice: 1 },
};

describe('GalleryMonthHeader', () => {
  it('names the month and what it holds', async () => {
    const { GalleryMonthHeader } = await import('@/components/moments/gallery-month-header');
    render(createElement(GalleryMonthHeader, { section: marchSection }));
    expect(screen.getByText('March 2026')).toBeTruthy();
    expect(screen.getByText('1 photo · 1 voice note')).toBeTruthy();
  });

  it('opens the month chapter from the divider', async () => {
    const onOpen = vi.fn();
    const { GalleryMonthHeader } = await import('@/components/moments/gallery-month-header');
    render(createElement(GalleryMonthHeader, { section: marchSection, onOpen }));
    fireEvent.click(screen.getByLabelText('Open March 2026 chapter'));
    expect(onOpen).toHaveBeenCalledWith(marchSection);
  });

  it('reads undated media as a heading, because there is no chapter behind it', async () => {
    const onOpen = vi.fn();
    const { GalleryMonthHeader } = await import('@/components/moments/gallery-month-header');
    render(
      createElement(GalleryMonthHeader, {
        section: { ...marchSection, id: 'month:undated', monthKey: 'undated', label: 'Undated' },
        onOpen,
      }),
    );
    expect(screen.getByText('Undated')).toBeTruthy();
    expect(screen.queryByLabelText('Open Undated chapter')).toBeNull();
  });
});
