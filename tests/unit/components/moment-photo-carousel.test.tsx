import { vi, describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { MomentOrderedImages } from '@/components/moments/moment-attachments';
import { MomentCard } from '@/components/moments/moment-card';

function flattenStyle(style: any): Record<string, any> {
  if (Array.isArray(style)) {
    const merged: Record<string, any> = {};
    for (const entry of style) {
      Object.assign(merged, flattenStyle(entry));
    }
    return merged;
  }
  return style && typeof style === 'object' ? style : {};
}

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children, style, type }: any) => (
    <span data-type={type} style={flattenStyle(style)}>
      {children}
    </span>
  ),
}));

vi.mock('@/components/ui/media-frame', () => ({
  MediaFrame: ({ children, aspectRatio }: any) => (
    <div data-testid="media-frame" data-aspect={String(aspectRatio)}>
      {children}
    </div>
  ),
}));

vi.mock('@/components/media/audio-player', () => ({
  AudioPlayer: ({ uri }: any) => <div data-testid="audio-player">{uri}</div>,
}));

// Distinct colors so the indicator can tell active from inactive dots.
vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: (_theme: any, key: string) => (key === 'accent' ? '#111111' : '#eeeeee'),
}));

vi.mock('expo-image', () => ({
  Image: ({ source, accessibilityLabel, style, ...props }: any) => {
    const React = require('react');
    return React.createElement('img', {
      style: flattenStyle(style),
      src: source?.uri,
      'aria-label': accessibilityLabel,
      ...props,
    });
  },
}));

// The shared react-native mock renders ScrollView as a plain View, which
// loses paging semantics. This local mock keeps the carousel props visible
// and auto-measures any View with onLayout so the paged branch renders.
vi.mock('react-native', () => {
  const React = require('react');

  const flatten = (style: any): any => {
    if (Array.isArray(style)) {
      const merged: Record<string, any> = {};
      for (const entry of style) {
        const flat = flatten(entry);
        if (flat && typeof flat === 'object') Object.assign(merged, flat);
      }
      return merged;
    }
    return style;
  };

  const withAria = (props: Record<string, any>) => {
    const next: Record<string, any> = { ...props };
    if (typeof props.accessibilityLabel === 'string') next['aria-label'] = props.accessibilityLabel;
    if (typeof props.onPress === 'function') next.onClick = props.onPress;
    return next;
  };

  const View = ({ children, style, onLayout, testID, ...rest }: any) => {
    React.useEffect(() => {
      if (typeof onLayout === 'function') {
        onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 240 } } });
      }
    }, [onLayout]);
    return React.createElement(
      'div',
      { style: flatten(style), ...(testID ? { 'data-testid': testID } : {}), ...withAria(rest) },
      children
    );
  };

  const Pressable = ({ children, style, onPress, testID, ...rest }: any) => {
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    const content = typeof children === 'function' ? children({ pressed: false }) : children;
    return React.createElement(
      'div',
      {
        style: flatten(resolved),
        onClick: onPress,
        ...(testID ? { 'data-testid': testID } : {}),
        ...withAria(rest),
      },
      content
    );
  };

  // onMomentumScrollEnd is intentionally not forwarded to the DOM; the
  // paging test drives it through react-test-renderer props instead.
  const ScrollView = ({ children, style, horizontal, pagingEnabled, snapToInterval, testID }: any) =>
    React.createElement(
      'div',
      {
        style: flatten(style),
        'data-testid': testID ?? 'photo-scroll',
        'data-horizontal': String(horizontal),
        'data-paging': String(pagingEnabled),
        'data-snap': String(snapToInterval),
      },
      children
    );

  const Text = ({ children, style, ...rest }: any) =>
    React.createElement('span', { style: flatten(style), ...withAria(rest) }, children);

  return {
    StyleSheet: { create: (styles: any) => styles, flatten, hairlineWidth: 1 },
    View,
    Text,
    Pressable,
    ScrollView,
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
    Platform: { OS: 'ios', select: (options: any) => options.ios },
  };
});

function makeMoment(overrides: Record<string, any> = {}) {
  return {
    id: 'moment-set',
    type: 'media' as const,
    title: 'Set',
    body: 'Three photos',
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

const THREE_PHOTOS = [
  { mediaId: 'photo-1', kind: 'image' as const, url: 'https://cdn.example.com/one.jpg' },
  { mediaId: 'photo-2', kind: 'image' as const, url: 'https://cdn.example.com/two.jpg' },
  { mediaId: 'photo-3', kind: 'image' as const, url: 'https://cdn.example.com/three.jpg' },
];

function threePhotoMoment() {
  return makeMoment({ attachments: THREE_PHOTOS });
}

describe('MomentOrderedImages timeline carousel', () => {
  it('lays a multi-photo set as an edge-bleed sideways strip with snap stops', () => {
    render(<MomentOrderedImages moment={threePhotoMoment()} paged onPhotoPress={() => {}} />);

    const scroll = screen.getByTestId('photo-scroll');
    expect(scroll.getAttribute('data-horizontal')).toBe('true');
    // One stride (304pt print + 8pt gap) per stop on the 390pt track.
    expect(scroll.getAttribute('data-snap')).toBe('312');

    const prints = Array.from(scroll.children);
    expect(prints).toHaveLength(3);
    for (const print of prints) {
      // Peek-sized: most of the track with the next print peeking in.
      expect((print as HTMLElement).style.width).toBe('304px');
    }

    expect(screen.getByLabelText('Photo 1 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Photo 2 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Photo 3 of 3')).toBeTruthy();
    // Feed prints fill their bounded 4:3 frame and may crop.
    expect(screen.getByLabelText('Photo 1 of 3').getAttribute('contentfit')).toBe('cover');
  });

  it('carries a small page indicator with one dot per photo', () => {
    render(<MomentOrderedImages moment={threePhotoMoment()} paged />);
    expect(screen.getAllByTestId('photo-page-dot')).toHaveLength(3);
  });

  it('moves the active dot as pages settle', async () => {
    const { ScrollView } = await import('react-native');
    const { create, act } = await import('react-test-renderer');

    let renderer: any;
    await act(async () => {
      renderer = create(<MomentOrderedImages moment={threePhotoMoment()} paged />);
    });

    const scroll = renderer.root.findByType(ScrollView);
    expect(scroll.props.snapToInterval).toBe(312);
    expect(scroll.props.horizontal).toBe(true);

    const dots = () =>
      renderer.root.findAll((node: any) => node.props?.testID === 'photo-page-dot');
    expect(dots()).toHaveLength(3);
    expect(flattenStyle(dots()[0].props.style).backgroundColor).toBe('#111111');
    expect(flattenStyle(dots()[1].props.style).backgroundColor).toBe('#eeeeee');

    await act(async () => {
      // One page settle: the measured page width is 320, so 640 would be
      // page two. Drive the offset the mock actually laid out.
      scroll.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 320 } } });
    });

    expect(flattenStyle(dots()[0].props.style).backgroundColor).toBe('#eeeeee');
    expect(flattenStyle(dots()[1].props.style).backgroundColor).toBe('#111111');
  });

  it('opens each page fullscreen from its own button', () => {
    const onPhotoPress = vi.fn();
    render(<MomentOrderedImages moment={threePhotoMoment()} paged onPhotoPress={onPhotoPress} />);

    fireEvent.click(screen.getByLabelText('Open photo 2 of 3 fullscreen'));
    expect(onPhotoPress).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByLabelText('Open photo 1 of 3 fullscreen'));
    expect(onPhotoPress).toHaveBeenCalledWith(0);
  });

  it('keeps a lone photo inline with no pager and no frame', () => {
    render(<MomentOrderedImages moment={makeMoment({ attachments: [THREE_PHOTOS[0]] })} paged />);

    expect(screen.queryByTestId('photo-scroll')).toBeNull();
    expect(screen.queryAllByTestId('photo-page-dot')).toHaveLength(0);
    expect(screen.queryByTestId('media-frame')).toBeNull();
    const image = screen.getByLabelText('Memory photo 1 of 1');
    expect(image.getAttribute('contentfit')).toBe('cover');
  });

  it('leaves the vertical stack when paged is off (article/detail)', () => {
    render(<MomentOrderedImages moment={threePhotoMoment()} />);

    expect(screen.queryByTestId('photo-scroll')).toBeNull();
    expect(screen.queryAllByTestId('photo-page-dot')).toHaveLength(0);
    expect(screen.getAllByTestId('media-frame')).toHaveLength(3);
    expect(screen.getByLabelText('Memory photo 1 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Memory photo 3 of 3')).toBeTruthy();
  });
});

describe('MomentCard photo-set presentation', () => {
  it('opts timeline into the carousel with fullscreen pages and no detail nav', () => {
    const onPress = vi.fn();
    const onPhotoPress = vi.fn();
    render(<MomentCard moment={threePhotoMoment()} presentation="timeline" onPress={onPress} onPhotoPress={onPhotoPress} />);

    expect(screen.getByTestId('photo-scroll')).toBeTruthy();
    expect(screen.queryByLabelText('Moment: Set')).toBeNull();
    // The set escapes the padded text column: its strip carries no
    // horizontal pad, so prints bleed off both screen edges.
    const strip = screen.getByTestId('photo-scroll').parentElement as HTMLElement;
    expect(strip.style.paddingLeft).toBe('');
    expect(strip.style.paddingRight).toBe('');
    fireEvent.click(screen.getByText('Three photos'));
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Open photo 3 of 3 fullscreen'));
    expect(onPhotoPress).toHaveBeenCalledWith('moment-set', 2);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('leaves the article detail presentation as the vertical stack', () => {
    render(<MomentCard moment={threePhotoMoment()} />);
    expect(screen.queryByTestId('photo-scroll')).toBeNull();
    expect(screen.getAllByTestId('media-frame')).toHaveLength(3);
  });
});

describe('MomentOrderedImages frame sizing', () => {
  function framesOf(renderer: any) {
    return renderer.root.findAll((node: any) => node.props?.['data-testid'] === 'media-frame');
  }

  it('renders every carousel page on one bounded 4:3 cover frame for mixed-dimension photos', async () => {
    const { create, act } = await import('react-test-renderer');
    let renderer: any;
    await act(async () => {
      renderer = create(<MomentOrderedImages moment={threePhotoMoment()} paged />);
    });

    const images = renderer.root.findAll((node: any) => node.type === 'img');
    expect(images).toHaveLength(3);
    // Portrait, landscape and panorama all fill the same fixed frame — the
    // feed may crop, so no measuring pass runs at all. (Props keep their
    // React casing under react-test-renderer, unlike DOM attributes.)
    for (const image of images) {
      expect(image.props.contentFit).toBe('cover');
      const frame = image.parent?.parent;
      expect(Number(flattenStyle(frame?.props.style).aspectRatio)).toBeCloseTo(4 / 3);
    }
  });

  it('leaves each photo its natural aspect outside the carousel (single and article)', async () => {
    const { create, act } = await import('react-test-renderer');
    let renderer: any;
    await act(async () => {
      renderer = create(<MomentOrderedImages moment={threePhotoMoment()} />);
    });

    const images = renderer.root.findAll((node: any) => node.type === 'img');
    await act(async () => {
      images[0].props.onLoad({ source: { width: 300, height: 900 } });
      images[1].props.onLoad({ source: { width: 1600, height: 900 } });
    });

    const frames = framesOf(renderer);
    expect(Number(frames[0].props['data-aspect'])).toBeCloseTo(3 / 4);
    expect(Number(frames[1].props['data-aspect'])).toBeCloseTo(16 / 9);
  });
});
