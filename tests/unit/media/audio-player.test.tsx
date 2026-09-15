import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

let capturedPlayerUri: string | null = null;

vi.mock('expo-audio', () => ({
  useAudioPlayer: (uri: string) => {
    capturedPlayerUri = uri;
    return {
      playing: false,
      duration: 0,
      currentTime: 0,
      play: vi.fn(),
      pause: vi.fn(),
    };
  },
}));

// Marker transform proves the player resolves through the shared util
// instead of handing the raw Documents-relative path to the OS.
vi.mock('@/features/composer/staged-uri', () => ({
  resolveStagedUri: (uri: string) => `resolved:${uri}`,
}));

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
  const Pressable = ({ children, onPress, accessibilityLabel }: any) =>
    React.createElement(
      'div',
      {
        ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
        ...(onPress ? { onClick: onPress } : {}),
      },
      children
    );
  return {
    View,
    Pressable,
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
  };
});

describe('AudioPlayer staged URIs', () => {
  beforeEach(() => {
    capturedPlayerUri = null;
  });

  it('resolves a staged-relative path before creating the player', async () => {
    const { AudioPlayer } = await import('@/components/media/audio-player');
    render(createElement(AudioPlayer, { uri: 'composer/v/s/staged/staged_v1.m4a' }));
    expect(capturedPlayerUri).toBe('resolved:composer/v/s/staged/staged_v1.m4a');
  });

  it('still renders its toggle control', async () => {
    const { AudioPlayer } = await import('@/components/media/audio-player');
    render(createElement(AudioPlayer, { uri: 'composer/v/s/staged/staged_v1.m4a' }));
    expect(screen.getByLabelText('Play voice note')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Play voice note'));
  });
});
