import { vi, describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MomentCard, clampPhotoAspect } from '@/components/moments/moment-card';

function flattenStyle(style: any): any {
  if (Array.isArray(style)) {
    const merged: Record<string, any> = {};
    for (const s of style) {
      if (s && typeof s === 'object') Object.assign(merged, s);
    }
    return merged;
  }
  return style;
}

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children, style, type }: any) => (
    <span data-type={type} style={flattenStyle(style)}>
      {children}
    </span>
  ),
}));

vi.mock('@/components/ui/media-frame', () => ({
  MediaFrame: ({ children }: any) => <div data-testid="media-frame">{children}</div>,
}));

vi.mock('@/components/media/audio-player', () => ({
  AudioPlayer: ({ uri }: any) => <div data-testid="audio-player">{uri}</div>,
}));

vi.mock('@/components/media/video-player', () => ({
  VideoPlayer: ({ uri, posterUri }: any) => (
    <div data-testid="video-player" data-poster={posterUri}>
      {uri}
    </div>
  ),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@expo/ui/community/menu', () => {
  const React = require('react');
  return {
    MenuView: ({ actions, onPressAction, children, testID }: any) =>
      React.createElement(
        'div',
        { 'data-testid': testID ?? 'menu' },
        children,
        ...(actions ?? []).map((a: any) =>
          React.createElement(
            'button',
            {
              key: a.id,
              'data-menu-action': a.id,
              onClick: () => onPressAction?.({ nativeEvent: { event: a.id } }),
            },
            a.title,
          ),
        ),
      ),
  };
});

// The shared react-native mock passes Pressable `style` straight through,
// but MomentCard computes `style={({ pressed }) => ...}`. Resolve press-state
// styles as unpressed so the real card renders in this file.
vi.mock('react-native', () => {
  const React = require('react');

  const flatten = (style: any): any => {
    if (Array.isArray(style)) {
      const merged: Record<string, any> = {};
      for (const s of style) {
        const flat = flatten(s);
        if (flat && typeof flat === 'object') Object.assign(merged, flat);
      }
      return merged;
    }
    return style;
  };

  const withAria = (props: Record<string, any>) => {
    const next: Record<string, any> = { ...props };
    if (typeof props.accessibilityLabel === 'string') {
      next['aria-label'] = props.accessibilityLabel;
    }
    if (typeof props.onPress === 'function') {
      next.onClick = props.onPress;
    }
    return next;
  };

  const View = ({ children, style, ...rest }: any) =>
    React.createElement('div', { style: flatten(style), ...withAria(rest) }, children);

  const Pressable = ({ children, style, onPress, ...rest }: any) => {
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    const content = typeof children === 'function' ? children({ pressed: false }) : children;
    return React.createElement(
      'div',
      { style: flatten(resolved), onClick: onPress, ...withAria(rest) },
      content,
    );
  };

  const Text = ({ children, style, ...rest }: any) =>
    React.createElement('span', { style: flatten(style), ...withAria(rest) }, children);

  return {
    StyleSheet: { create: (styles: any) => styles, flatten },
    View,
    Text,
    Pressable,
    Platform: { OS: 'ios', select: (options: any) => options.ios },
  };
});

function makeMoment(overrides: Record<string, any> = {}) {
  return {
    id: 'moment-1',
    type: 'note' as const,
    title: 'Test moment',
    body: 'Test body content',
    occurredAt: '2026-03-15T10:00:00.000Z',
    targetAt: null,
    createdAt: '2026-03-15T10:00:00.000Z',
    updatedAt: '2026-03-15T10:00:00.000Z',
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    mediaPreview: null,
    audioUri: null,
    ...overrides,
  };
}

describe('MomentCard (Story entry)', () => {
  it('renders title and body as type, without card filler', () => {
    render(<MomentCard moment={makeMoment()} />);
    expect(screen.getByText('Test moment')).toBeTruthy();
    expect(screen.getByText('Test body content')).toBeTruthy();
  });

  it('omits empty title and body instead of filler copy', () => {
    render(<MomentCard moment={makeMoment({ title: '', body: '' })} />);
    expect(screen.queryByText('Untitled moment')).toBeNull();
    expect(screen.queryByText('No details added yet.')).toBeNull();
  });

  it('treats the legacy untitled placeholder as no title', () => {
    render(<MomentCard moment={makeMoment({ title: 'Untitled moment', body: 'Body here' })} />);
    expect(screen.queryByText('Untitled moment')).toBeNull();
    expect(screen.getByText('Body here')).toBeTruthy();
  });

  it('attributes authorship quietly in the meta line', () => {
    const { unmount: unmountYou } = render(
      <MomentCard moment={makeMoment({ authorRole: 'you', authorName: 'You' })} />
    );
    expect(screen.getByText(/Mar 15, 2026 · You/)).toBeTruthy();
    unmountYou();

    render(
      <MomentCard moment={makeMoment({ authorRole: 'partner', authorName: 'Alex' })} />
    );
    expect(screen.getByText(/Mar 15, 2026 · Alex/)).toBeTruthy();
  });

  it('shows no type labels or status pills', () => {
    render(
      <MomentCard moment={makeMoment({ type: 'media', mediaPreview: 'https://cdn.example.com/img.jpg' })} />
    );
    expect(screen.queryByText('Media')).toBeNull();
    expect(screen.queryByText('Milestone')).toBeNull();
    expect(screen.queryByText('Trace')).toBeNull();
    expect(screen.queryByText('Note')).toBeNull();
  });

  it('renders a photo memory large inside a frame', () => {
    const { container } = render(
      <MomentCard moment={makeMoment({ type: 'media', mediaPreview: 'https://cdn.example.com/img.jpg' })} />
    );
    expect(screen.getByTestId('media-frame')).toBeTruthy();
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://cdn.example.com/img.jpg');
  });

  it('never destructively crops the Story photo (contain, full frame)', () => {
    const { container } = render(
      <MomentCard moment={makeMoment({ type: 'media', mediaPreview: 'https://cdn.example.com/portrait.jpg' })} />
    );
    const image = container.querySelector('img');
    // contain = the complete image always shows; no cover crop.
    expect(image?.getAttribute('contentfit')).toBe('contain');
    expect(image?.getAttribute('src')).toBe('https://cdn.example.com/portrait.jpg');
  });

  it('plays a dev-preview video memory and uses its still only as the poster', () => {
    const { container } = render(
      <MomentCard
        moment={makeMoment({
          type: 'media',
          title: 'Beach clip',
          mediaPreview: 'https://cdn.example.com/poster.jpg',
          videoUri: 'https://cdn.example.com/clip.mp4',
        })}
      />
    );
    const player = screen.getByTestId('video-player');
    expect(player.textContent).toContain('https://cdn.example.com/clip.mp4');
    // The mediaPreview still is the poster, not a second rendered image.
    expect(player.getAttribute('data-poster')).toBe('https://cdn.example.com/poster.jpg');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByTestId('media-frame')).toBeNull();
  });

  it('keeps portrait photos portrait and landscape photos landscape', () => {
    // Portrait stays portrait, landscape stays landscape — both first-class.
    expect(clampPhotoAspect(3 / 4)).toBeCloseTo(3 / 4);
    expect(clampPhotoAspect(9 / 16)).toBeCloseTo(3 / 4);
    expect(clampPhotoAspect(4 / 3)).toBeCloseTo(4 / 3);
    expect(clampPhotoAspect(16 / 9)).toBeCloseTo(16 / 9);
  });

  it('clamps absurd ratios instead of exploding the layout', () => {
    // Extreme panorama letterboxes at 16:9; extreme strip at 3:4.
    expect(clampPhotoAspect(4)).toBeCloseTo(16 / 9);
    expect(clampPhotoAspect(0.2)).toBeCloseTo(3 / 4);
  });

  it('falls back to 4:3 for invalid measurements', () => {
    expect(clampPhotoAspect(0)).toBeCloseTo(4 / 3);
    expect(clampPhotoAspect(-1)).toBeCloseTo(4 / 3);
    expect(clampPhotoAspect(Number.NaN)).toBeCloseTo(4 / 3);
  });

  it('renders a voice memory with its player and no technical metadata', () => {
    render(
      <MomentCard
        moment={makeMoment({ type: 'trace', title: '', body: '', audioUri: 'https://cdn.example.com/v.m4a' })}
      />
    );
    const player = screen.getByTestId('audio-player');
    expect(player.textContent).toContain('https://cdn.example.com/v.m4a');
    expect(screen.queryByText(/codec|bitrate|kilobit/i)).toBeNull();
  });

  it('shows the goal target as quiet text without a pill', () => {
    render(
      <MomentCard
        moment={makeMoment({
          type: 'goal',
          title: 'Build feature',
          body: 'Work in progress',
          // midday UTC keeps local-timezone formatting on the same calendar day in CI
          targetAt: '2026-05-31T12:00:00.000Z',
        })}
      />
    );
    expect(screen.queryByText('Goal')).toBeNull();
    expect(screen.getByText(/May 31, 2026/)).toBeTruthy();
  });

  it('shows the edited marker when updatedAt is more than 1s after createdAt', () => {
    render(
      <MomentCard
        moment={makeMoment({
          createdAt: '2026-03-15T10:00:00.000Z',
          updatedAt: '2026-03-16T09:30:00.000Z',
        })}
      />
    );
    expect(screen.getByText(/Edited/)).toBeTruthy();
  });

  it('does not show the edited marker within the 1s tolerance', () => {
    render(
      <MomentCard
        moment={makeMoment({
          createdAt: '2026-03-15T10:00:00.000Z',
          updatedAt: '2026-03-15T10:00:00.800Z',
        })}
      />
    );
    expect(screen.queryByText(/Edited/)).toBeNull();
  });

  it('does not show the edited marker when updatedAt is missing', () => {
    render(<MomentCard moment={makeMoment()} />);
    expect(screen.queryByText(/Edited/)).toBeNull();
  });

  it('keeps voice playback outside the nav pressable so play never opens detail', () => {
    const onPress = vi.fn();
    const onLongPress = vi.fn();
    // Real voice seed shape: trace with no title/body, audio only.
    render(
      <MomentCard
        moment={makeMoment({ type: 'trace', title: '', body: '', audioUri: 'https://cdn.example.com/v.m4a' })}
        onLongPress={onLongPress}
        onPress={onPress}
      />
    );
    const player = screen.getByTestId('audio-player');
    const navButton = screen.getByLabelText('Moment');
    expect(navButton.contains(player)).toBe(false);

    // Tapping playback never routes to detail.
    fireEvent.click(player);
    expect(onPress).not.toHaveBeenCalled();

    // The nav region still opens detail with the moment id.
    fireEvent.click(navButton);
    expect(onPress).toHaveBeenCalledWith('moment-1');
  });

  it('renders audio as a sibling after the clickable content without moving it inside nav', () => {
    const onPress = vi.fn();
    const { container } = render(
      <MomentCard
        moment={makeMoment({ title: 'T', body: 'B', audioUri: 'https://cdn.example.com/v.m4a' })}
        onPress={onPress}
      />
    );
    const player = screen.getByTestId('audio-player');
    const navButton = screen.getByLabelText('Moment: T');
    expect(navButton.contains(player)).toBe(false);
    // Clickable photo/title/meta/body stay inside nav; audio stays out.
    expect(navButton.textContent).toContain('T');
    expect(navButton.textContent).toContain('B');
    expect(container.contains(player)).toBe(true);
  });

  it('leads photo entries with the photo, then date/byline, then caption', () => {
    render(
      <MomentCard
        moment={makeMoment({
          type: 'media',
          title: 'Beach day',
          body: 'Golden hour swim',
          mediaPreview: 'https://cdn.example.com/beach.jpg',
        })}
      />
    );
    const frame = screen.getByTestId('media-frame');
    const meta = screen.getByText(/Mar 15, 2026 · You/);
    const titleEl = screen.getByText('Beach day');
    const bodyEl = screen.getByText('Golden hour swim');
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(frame.compareDocumentPosition(meta) & FOLLOWING).toBeTruthy();
    expect(meta.compareDocumentPosition(titleEl) & FOLLOWING).toBeTruthy();
    expect(titleEl.compareDocumentPosition(bodyEl) & FOLLOWING).toBeTruthy();
  });

  it('keeps date above title/body for text-only entries', () => {
    render(
      <MomentCard moment={makeMoment({ title: 'Quiet note', body: 'Just words' })} />
    );
    expect(screen.queryByTestId('media-frame')).toBeNull();
    const meta = screen.getByText(/Mar 15, 2026 · You/);
    const titleEl = screen.getByText('Quiet note');
    const bodyEl = screen.getByText('Just words');
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(meta.compareDocumentPosition(titleEl) & FOLLOWING).toBeTruthy();
    expect(titleEl.compareDocumentPosition(bodyEl) & FOLLOWING).toBeTruthy();
  });

  it('groups the photo caption closely (8) below the photo block (12)', () => {
    render(
      <MomentCard
        moment={makeMoment({
          type: 'media',
          title: 'Caption title',
          body: 'Caption body',
          mediaPreview: 'https://cdn.example.com/caption.jpg',
        })}
      />
    );
    const titleEl = screen.getByText('Caption title');
    const captionGroup = titleEl.parentElement;
    expect(captionGroup?.style.gap).toMatch(/8/);
    // Photo-to-caption rhythm stays at the entry 12 token via the nav stack.
    const navStack = captionGroup?.parentElement;
    expect(navStack?.style.gap).toMatch(/12/);
  });

  it('gives subtle press feedback with opacity only (no resize/bounce)', async () => {
    const { Pressable } = await import('react-native');
    const { create, act } = await import('react-test-renderer');
    let renderer: any;
    await act(async () => {
      renderer = create(
        <MomentCard moment={makeMoment({ title: 'Press me', body: 'Body' })} onPress={() => {}} />
      );
    });
    const button = renderer.root.findByType(Pressable);
    const styleFn = button.props.style;
    expect(typeof styleFn).toBe('function');
    // Resting state applies no dimming.
    const flatResting = flattenStyle(styleFn({ pressed: false })) ?? {};
    expect(flatResting.opacity).toBeUndefined();
    // Pressing dims only via opacity — no resize of the photo, no bounce.
    const flatPressed = flattenStyle(styleFn({ pressed: true })) ?? {};
    expect(flatPressed.opacity).toBeCloseTo(0.92);
    expect(flatPressed.transform).toBeUndefined();
    expect(flatPressed.scale).toBeUndefined();
  });
});

describe('MomentCard presentation="timeline" (Memories compact row)', () => {
  const longWord = `Supercalifragilisticexpialidocious${'x'.repeat(80)} \u{1F389}\u{1F942}\u2728 family keeps every character`;

  function expectedTime(iso: string) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function expectedShortDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  it('keeps the article default unchanged (full date caption, larger types)', () => {
    render(<MomentCard moment={makeMoment({ title: 'T', body: 'B' })} />);
    expect(screen.getByText(/Mar 15, 2026 · You/)).toBeTruthy();
    expect(screen.getByText('T').getAttribute('data-type')).toBe('title');
    expect(screen.getByText('B').getAttribute('data-type')).toBe('body');
  });

  it('captions a short local date and time (the feed no longer prints day headers)', () => {
    // Midday UTC keeps the local calendar day stable across CI timezones.
    const at = '2026-09-10T12:00:00.000Z';
    render(
      <MomentCard
        moment={makeMoment({ title: 'T', body: 'B', occurredAt: at })}
        presentation="timeline"
      />
    );
    const meta = screen.getByText(`· ${expectedShortDate(at)} · ${expectedTime(at)}`);
    expect(meta).toBeTruthy();
    expect(meta.getAttribute('data-type')).toBe('supporting');
    // The author is its own segment, so the day/time text stays neutral.
    expect(screen.getByText('You')).toBeTruthy();
    // The full dated caption remains article-only.
    const year = new Date(at).getFullYear();
    expect(screen.queryByText(`${expectedShortDate(at)}, ${year}`)).toBeNull();
  });

  it('uses an intentional entry hierarchy with compact 8px rhythm', () => {
    render(
      <MomentCard
        moment={makeMoment({ title: 'Compact title', body: 'Compact body' })}
        presentation="timeline"
      />
    );
    const titleEl = screen.getByText('Compact title');
    const bodyEl = screen.getByText('Compact body');
    expect(titleEl.getAttribute('data-type')).toBe('subheading');
    expect(bodyEl.getAttribute('data-type')).toBe('body');
    const navStack = titleEl.parentElement?.parentElement;
    expect(navStack?.style.gap).toMatch(/8/);
  });

  it('renders full unicode and long unbroken words with no truncation', () => {
    render(
      <MomentCard
        moment={makeMoment({ title: 'Emoji note \u{1F389}', body: longWord })}
        presentation="timeline"
      />
    );
    expect(screen.getByText('Emoji note \u{1F389}')).toBeTruthy();
    expect(screen.getByText(longWord)).toBeTruthy();
    // Wrap-safe chain stays on the text so long words never push sideways.
    const bodyEl = screen.getByText(longWord) as HTMLElement;
    expect(bodyEl.style.flexShrink).toBe('1');
  });

  it('renders a bounded timeline photo with cover fit and no article frame', () => {
    const { container } = render(
      <MomentCard
        moment={makeMoment({
          type: 'media',
          title: 'Beach day',
          body: 'Golden hour swim',
          mediaPreview: 'https://cdn.example.com/beach.jpg',
        })}
        presentation="timeline"
      />
    );
    // Timeline media uses a bounded 4:3 frame; article keeps contain.
    // (The frame itself is asserted at the props level in the carousel
    // sizing test — happy-dom drops aspect-ratio from computed style.)
    expect(screen.queryByTestId('media-frame')).toBeNull();
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://cdn.example.com/beach.jpg');
    expect(image?.getAttribute('contentfit')).toBe('cover');
    expect(screen.getByText('Beach day').getAttribute('data-type')).toBe('subheading');
  });

  it('never opens detail from the timeline photo; tapping it goes fullscreen', () => {
    const onPress = vi.fn();
    const onLongPress = vi.fn();
    const onPhotoPress = vi.fn();
    const { container } = render(
      <MomentCard
        moment={makeMoment({
          type: 'media',
          title: 'Beach day',
          body: 'Golden hour swim',
          mediaPreview: 'https://cdn.example.com/beach.jpg',
        })}
        presentation="timeline"
        onPress={onPress}
        onLongPress={onLongPress}
        onPhotoPress={onPhotoPress}
      />
    );
    const image = container.querySelector('img') as HTMLElement;
    // The caption keeps its hold-for-actions pressable, but tapping it
    // never navigates from the timeline.
    expect(screen.getByLabelText('Moment: Beach day')).toBeTruthy();
    fireEvent.click(screen.getByText('Golden hour swim'));
    expect(onPress).not.toHaveBeenCalled();
    // The photo sits in its own fullscreen button instead.
    const photoButton = screen.getByLabelText('Open photo fullscreen');
    expect(photoButton.contains(image)).toBe(true);
    fireEvent.click(photoButton);
    expect(onPhotoPress).toHaveBeenCalledWith('moment-1', 0);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders no nav target on timeline photos without actions', () => {
    render(
      <MomentCard
        moment={makeMoment({
          type: 'media',
          title: 'Beach day',
          body: 'Golden hour swim',
          mediaPreview: 'https://cdn.example.com/beach.jpg',
        })}
        presentation="timeline"
        onPress={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('Moment: Beach day')).toBeNull();
  });

  it('never opens detail from a text or audio post in timeline', () => {
    const onPress = vi.fn();
    const { container } = render(
      <MomentCard
        moment={makeMoment({
          type: 'trace',
          title: '',
          body: 'Voice thought \u{1F399}',
          audioUri: 'https://cdn.example.com/v.m4a',
        })}
        onPress={onPress}
        presentation="timeline"
      />
    );
    expect(screen.getByText('Voice thought \u{1F399}')).toBeTruthy();
    // No way in: neither byline nor caption navigates for audio-only posts.
    expect(screen.queryByLabelText('Moment')).toBeNull();
    fireEvent.click(screen.getByText('Voice thought \u{1F399}'));
    expect(onPress).not.toHaveBeenCalled();
    // Playback still works inline.
    const player = screen.getByTestId('audio-player');
    expect(player.textContent).toContain('https://cdn.example.com/v.m4a');
    expect(container.contains(player)).toBe(true);
    fireEvent.click(player);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('never opens detail from a text-only post in timeline', () => {
    const onPress = vi.fn();
    render(
      <MomentCard
        moment={makeMoment({ title: 'Just words', body: 'Nothing to open' })}
        onPress={onPress}
        presentation="timeline"
      />
    );
    expect(screen.queryByLabelText('Moment: Just words')).toBeNull();
    fireEvent.click(screen.getByText('Nothing to open'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('opens explicit actions without navigating when native long-press owns the gesture', () => {
    const onPress = vi.fn();
    const onActions = vi.fn();
    render(<MomentCard moment={makeMoment()} presentation="timeline" onPress={onPress} onActions={onActions} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(onActions).toHaveBeenCalledWith('moment-1');
    expect(onPress).not.toHaveBeenCalled();
  });

  it('opens the native popover from the ellipsis instead of the sheet fallback', () => {
    const onPress = vi.fn();
    const onActions = vi.fn();
    const onAction = vi.fn();
    const { container } = render(
      <MomentCard
        moment={makeMoment()}
        presentation="timeline"
        onPress={onPress}
        onActions={onActions}
        nativeActionsMenu={{
          actions: [
            { id: 'edit', title: 'Edit' },
            { id: 'delete', title: 'Delete', attributes: { destructive: true } },
          ],
          title: 'Test moment',
          onAction,
        }}
      />
    );
    // The trigger rides the native menu...
    const menu = screen.getByTestId('native-actions-menu');
    expect(menu.querySelector('[aria-label="More actions"]')).toBeTruthy();
    expect(container.contains(menu)).toBe(true);
    // ...tapping it never fires the sheet fallback, and never navigates.
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(onActions).not.toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
    // Menu actions route through onAction with the native event id.
    fireEvent.click(menu.querySelector('[data-menu-action="edit"]') as HTMLElement);
    expect(onAction).toHaveBeenCalledWith('edit');
    fireEvent.click(menu.querySelector('[data-menu-action="delete"]') as HTMLElement);
    expect(onAction).toHaveBeenCalledWith('delete');
  });

  it('opens a captionless photo fullscreen from its print, never from its byline', () => {
    const onPress = vi.fn();
    const onPhotoPress = vi.fn();
    render(
      <MomentCard
        moment={makeMoment({ title: '', body: '', mediaPreview: 'https://cdn.example.com/photo.jpg' })}
        presentation="timeline"
        onPress={onPress}
        onPhotoPress={onPhotoPress}
      />
    );
    expect(screen.queryByLabelText('Moment')).toBeNull();
    fireEvent.click(screen.getByLabelText('Open photo fullscreen'));
    expect(onPhotoPress).toHaveBeenCalledWith('moment-1', 0);
    expect(onPress).not.toHaveBeenCalled();
  });
});
