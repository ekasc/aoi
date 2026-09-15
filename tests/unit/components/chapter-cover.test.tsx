import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

import { ChapterCover } from '@/components/moments/chapter-cover';
import type { Chapter } from '@/features/moments/chapters';

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'month:2026-08',
    kind: 'monthly',
    title: 'August 2026',
    subtitle: '3 memories',
    memoryIds: ['m1', 'm2', 'm3'],
    coverPhotoUri: null,
    monthKey: '2026-08',
    anniversaryYear: null,
    ...overrides,
  };
}

describe('ChapterCover', () => {
  it('renders the representative photo with its title band', () => {
    const { container } = render(
      <ChapterCover
        chapter={makeChapter({ coverPhotoUri: 'https://cdn.test/cover.jpg' })}
        width={240}
      />
    );

    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://cdn.test/cover.jpg');
    expect(image?.getAttribute('contentfit')).toBe('cover');
    expect(screen.getByText('August 2026')).toBeTruthy();
    expect(screen.getByText('3 memories')).toBeTruthy();
  });

  it('holds the 4:5 master ratio', () => {
    const { container } = render(
      <ChapterCover chapter={makeChapter()} width={200} />
    );

    const frame = container.firstElementChild as HTMLElement;
    expect(frame.style.width).toBe('200px');
    expect(frame.style.height).toBe('250px');
  });

  it('falls back to paper, numeral, and restraint without photography', () => {
    const { container } = render(
      <ChapterCover chapter={makeChapter()} width={240} />
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('08')).toBeTruthy();
    expect(screen.getByText('August 2026')).toBeTruthy();
  });

  it('falls back to the anniversary year numeral', () => {
    render(
      <ChapterCover
        chapter={makeChapter({
          id: 'anniversary:2:2026',
          kind: 'anniversary',
          title: 'Two years together',
          monthKey: null,
          anniversaryYear: 2,
        })}
        width={240}
      />
    );

    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('Two years together')).toBeTruthy();
  });
});
