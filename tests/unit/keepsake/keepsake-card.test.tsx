import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  KeepsakeCard,
  formatKeepsakeRange,
} from '@/components/keepsake/keepsake-card';
import { BeachThemes } from '@/constants/theme-presets';

vi.mock('expo-image', () => ({
  Image: ({ source }: { source?: { uri?: string } }) => (
    <img alt="" src={source?.uri ?? ''} />
  ),
}));

const card = {
  title: 'August 2026',
  subtitle: '14 memories',
  dateRange: 'Aug 1 – Aug 31, 2026',
  coverPhotoUri: 'https://example.com/cover.jpg',
};

describe('formatKeepsakeRange', () => {
  it('collapses single-day ranges', () => {
    const day = new Date(2026, 7, 15, 12).getTime();
    expect(formatKeepsakeRange(day, day)).toBe('Aug 15, 2026');
  });

  it('spans multi-day ranges with the year once', () => {
    const from = new Date(2026, 7, 1, 12).getTime();
    const to = new Date(2026, 7, 31, 12).getTime();
    expect(formatKeepsakeRange(from, to)).toBe('Aug 1 – Aug 31, 2026');
  });
});

describe('KeepsakeCard', () => {
  it('shows title, count, range, and photo', () => {
    render(
      <KeepsakeCard
        card={card}
        colors={BeachThemes['after-hours'].light}
        themeName="After Hours"
      />
    );

    expect(screen.getByText('August 2026')).toBeTruthy();
    expect(screen.getByText('14 memories')).toBeTruthy();
    expect(screen.getByText('Aug 1 – Aug 31, 2026')).toBeTruthy();
    expect(screen.getByLabelText(/Keepsake card: August 2026/)).toBeTruthy();
  });

  it('adapts surfaces to the theme: wine dusk vs bright water', () => {
    const { unmount } = render(
      <KeepsakeCard
        card={{ ...card, coverPhotoUri: null }}
        colors={BeachThemes['after-hours'].dark}
        themeName="After Hours"
      />
    );
    const dusky = screen.getByLabelText(/Keepsake card: August 2026/);
    unmount();

    render(
      <KeepsakeCard
        card={{ ...card, coverPhotoUri: null }}
        colors={BeachThemes.beach.light}
        themeName="Beach"
      />
    );
    const watery = screen.getByLabelText(/Keepsake card: August 2026/);

    const duskyBg = (dusky as HTMLElement).style.backgroundColor;
    const wateryBg = (watery as HTMLElement).style.backgroundColor;
    expect(duskyBg).toBeTruthy();
    expect(wateryBg).toBeTruthy();
    expect(duskyBg).not.toBe(wateryBg);
  });

  it('omits the photo frame when there is no cover', () => {
    const { container } = render(
      <KeepsakeCard
        card={{ ...card, coverPhotoUri: null }}
        colors={BeachThemes.beach.light}
        themeName="Beach"
      />
    );

    expect(container.querySelector('img')).toBeNull();
  });

  it('names the theme it was kept in', () => {
    render(
      <KeepsakeCard
        card={{ ...card, coverPhotoUri: null }}
        colors={BeachThemes.beach.dark}
        themeName="Beach"
      />
    );

    expect(screen.getByText(/kept in aoi · Beach/)).toBeTruthy();
  });
});
