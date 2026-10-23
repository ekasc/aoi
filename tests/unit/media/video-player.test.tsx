import { render } from '@testing-library/react';
import { useLayoutEffect, useMemo } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { VideoSurface } from '@/components/media/video-player';

let attached = false;
const playRequests: boolean[] = [];
const player = { loop: false, play: () => { playRequests.push(attached); } };

vi.mock('expo-video', () => ({
  useVideoPlayer: (_uri: string, setup: (instance: typeof player) => void) => {
    useMemo(() => setup(player), [setup]);
    return player;
  },
  VideoView: () => {
    useLayoutEffect(() => {
      attached = true;
      return () => { attached = false; };
    }, []);
    return null;
  },
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('@/components/ui/media-frame', () => ({ MediaFrame: () => null }));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#000000' }));

describe('VideoSurface playback', () => {
  it('starts playback after the video view has attached, not before it has a surface to play', () => {
    playRequests.length = 0;
    render(<VideoSurface uri="https://cdn.test/clip.mp4" label="Aquarium" />);
    expect(playRequests).toEqual([true]);
  });
});
