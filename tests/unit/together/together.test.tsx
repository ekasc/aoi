import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

/**
 * Us: one memory, and the exchange on it.
 *
 * This file used to pin a landing page. Half the viewport was an ambient
 * hero, a scroll cue said there was more below, and a "More ways to connect"
 * section listed the app's own features. Those assertions are gone because
 * the thing they were guarding is gone.
 *
 * What is here instead splits into two kinds, and the difference matters:
 *
 *  - Honesty and safety contracts, which are the reason this suite is worth
 *    keeping at all. A sealed letter's words must never appear before the
 *    seal breaks. A loading shelf must never look like an empty one. A
 *    failure must never leak a raw error. Nothing here polls. None of that
 *    changed when the screen changed shape, and all of it survives.
 *  - Shape contracts, which now describe a screen that is one artifact and
 *    the exchange on it, with no page furniture.
 */
vi.mock('react-native', () => {
  function flattenStyle(style: any): any {
    if (Array.isArray(style)) {
      const merged: Record<string, any> = {};
      for (const s of style) {
        const flat = flattenStyle(s);
        if (flat && typeof flat === 'object') Object.assign(merged, flat);
      }
      return merged;
    }
    return style;
  }
  function withAriaProps(props: Record<string, any>): Record<string, any> {
    const next: Record<string, any> = { ...props };
    if (typeof props.accessibilityLabel === 'string') next['aria-label'] = props.accessibilityLabel;
    if (props.accessibilityState && typeof props.accessibilityState.disabled === 'boolean') {
      next['aria-disabled'] = String(props.accessibilityState.disabled);
    }
    if (props.accessibilityState && typeof props.accessibilityState.busy === 'boolean') {
      next['aria-busy'] = String(props.accessibilityState.busy);
    }
    if (typeof props.onPress === 'function') next.onClick = props.onPress;
    return next;
  }
  function div(children: any, style: any, props: Record<string, any> = {}) {
    const React = require('react');
    return React.createElement('div', { style: flattenStyle(style), ...withAriaProps(props) }, children);
  }
  function span(children: any, style: any, props: Record<string, any> = {}) {
    const React = require('react');
    return React.createElement('span', { style: flattenStyle(style), ...withAriaProps(props) }, children);
  }

  const View = (props: any) => {
    const { children, style, ...rest } = props;
    return div(children, style, rest);
  };
  const Text = (props: any) => {
    const { children, style, ...rest } = props;
    return span(children, style, rest);
  };
  const Pressable = (props: any) => {
    const { children, style, disabled, ...rest } = props;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    const content = typeof children === 'function' ? children({ pressed: false }) : children;
    return div(content, resolved, {
      ...rest,
      ...(disabled || rest['aria-disabled'] ? { 'aria-disabled': String(disabled ?? true) } : {}),
    });
  };
  const ScrollView = (props: any) => {
    const { children, style, contentContainerStyle, contentInsetAdjustmentBehavior, showsVerticalScrollIndicator, ...rest } = props;
    (globalThis as any).__usScrollViews ??= [];
    (globalThis as any).__usScrollViews.push(rest);
    return div(children, style, rest);
  };

  return {
    StyleSheet: {
      create: (s: Record<string, any>) => s,
      hairlineWidth: 1,
      absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
      flatten: flattenStyle,
    },
    Platform: { OS: 'ios', select: (o: { ios?: unknown }) => o.ios },
    View,
    Text,
    Pressable,
    ScrollView,
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
    ActivityIndicator: () => null,
    Image: () => null,
    TextInput: (props: any) => createElement('input', { value: props.value ?? '' }),
  };
});

vi.mock('@/components/themed-text', () => ({
  ThemedText: (props: any) => {
    const { children, style, type, ...rest } = props;
    const React = require('react');
    return React.createElement(
      'span',
      { style, 'data-type': type, ...(rest['aria-label'] ? { 'aria-label': rest['aria-label'] } : {}), ...(rest.accessibilityRole ? { role: rest.accessibilityRole } : {}) },
      children
    );
  },
}));

vi.mock('@/components/ui/button', () => ({
  Button: (props: any) => {
    const { label, onPress, disabled } = props;
    const React = require('react');
    return React.createElement('button', { onClick: onPress, disabled, 'aria-label': label }, label);
  },
}));

vi.mock('@/components/ui/screen-header', () => ({
  ScreenHeader: (props: any) => {
    const React = require('react');
    return React.createElement('div', { 'aria-label': `header:${props.title}` }, props.title);
  },
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: (props: any) => {
    const React = require('react');
    return React.createElement('div', { style: props.style }, props.children);
  },
}));

vi.mock('@/components/ui/frosted-backdrop', () => ({ FrostedBackdrop: () => null }));

vi.mock('@/components/home/memory-sky', () => ({
  MemorySky: (props: any) => {
    const React = require('react');
    return React.createElement(
      'div',
      {
        'data-testid': 'sky',
        'data-immersive': String(Boolean(props.immersive)),
        'data-pressable': String(typeof props.onPress === 'function'),
        onClick: () => {
          if (typeof props.onPress === 'function') props.onPress();
        },
      },
      props.children
    );
  },
  SYSTEM_TAB_BAR_IOS_CLEARANCE: 50,
}));

vi.mock('@/components/media/audio-player', () => ({ AudioPlayer: () => createElement('div', { 'aria-label': 'audio' }) }));
// The exchange's capture paths need native modules this environment has not
// got. The screen's own job is the artifact and the exchange, not the picker.
vi.mock('@/components/media/media-picker', () => ({
  MediaPicker: () => createElement('div', { 'aria-label': 'picker' }),
}));
vi.mock('@/components/media/voice-recorder', () => ({
  VoiceRecorder: () => createElement('div', { 'aria-label': 'recorder' }),
}));
vi.mock('@/components/ui/native-sheet', () => ({
  NativeSheet: (props: any) =>
    props.visible ? createElement('div', { 'aria-label': 'sheet' }, props.children) : null,
}));
vi.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images', Videos: 'Videos' },
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: true })),
  launchCameraAsync: vi.fn(async () => ({ canceled: true })),
}));
vi.mock('expo-blur', () => ({ BlurView: (props: any) => createElement('div', null, props.children) }));
vi.mock('@/components/media/video-player', () => ({ VideoPlayer: () => createElement('div', { 'aria-label': 'video' }) }));
vi.mock('expo-image', () => ({ Image: () => null }));
// Pulled in transitively by the audio player; needs a global to construct.
vi.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(), remove: vi.fn() }),
  setAudioModeAsync: vi.fn(async () => {}),
  RecordingPresets: { HIGH_QUALITY: {} },
  useAudioRecorder: () => ({ record: vi.fn(), stop: vi.fn() }),
  useAudioRecorderState: () => ({ isRecording: false }),
}));

vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#000000' }));

const loadForSpy = vi.fn();
const addResponseSpy = vi.fn(async () => true);
let mockResponses: any[] = [];
vi.mock('@/features/responses/responses-context', () => ({
  useResponses: () => ({ responses: mockResponses, isLoading: false, error: null, loadFor: loadForSpy, add: addResponseSpy }),
}));

const sendSqueezeSpy = vi.fn(async () => {});
const addMomentSpy = vi.fn();
let mockSqueezeSending = false;
let mockLastSentAt: string | null = null;
let mockLetters: any[] = [];
let mockLettersLoading = false;
let mockLettersError: string | null = null;
let mockMoments: any[] = [];
let mockMomentsLoading = false;
let mockMomentsError: string | null = null;
let mockSpace: any = { name: 'Home', partnerName: 'June', relationshipStartDate: '2024-06-01' };

vi.mock('@/features/letters/letters-context', () => ({
  useLetters: () => ({ letters: mockLetters, isLoading: mockLettersLoading, error: mockLettersError, reload: vi.fn() }),
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({ moments: mockMoments, isLoading: mockMomentsLoading, error: mockMomentsError, refresh: vi.fn(), addMoment: addMomentSpy }),
}));

vi.mock('@/features/squeeze/squeeze-context', () => ({
  useSqueeze: () => ({ sendSqueeze: sendSqueezeSpy, isSending: mockSqueezeSending, lastSentAt: mockLastSentAt }),
}));

// The exchange stamps authorship from the session, so it is needed here.
// Mocked at the seam: the real one reaches for SecureStore, which has no
// implementation in this environment.
vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({ user: { id: 'u1', displayName: 'You', email: 'you@example.com' } }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: mockSpace, status: 'ready' }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

const pushSpy = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: pushSpy, back: vi.fn(), replace: vi.fn() }),
  useIsFocused: () => true,
  useFocusEffect: (effect: () => void | (() => void)) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    require('react').useEffect(effect, [effect]);
  },
}));

const press = async (element: Element) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

const makeMoment = (over: Record<string, any> = {}) => ({
  id: 'm1',
  type: 'media',
  title: 'Aquarium afternoon',
  body: '',
  occurredAt: '2026-06-21T11:00:00.000Z',
  createdAt: '2026-06-21T11:00:00.000Z',
  authorId: 'u2',
  authorRole: 'partner',
  authorName: 'June',
  isOwn: false,
  mediaPreview: 'https://cdn.example.com/a.jpg',
  ...over,
});

const makeLetter = (over: Record<string, any> = {}) => ({
  id: 'l1',
  caption: 'For later',
  createdAt: '2026-01-01T00:00:00.000Z',
  authorRole: 'you',
  authorName: 'You',
  sealedUntil: '2027-01-01T00:00:00.000Z',
  isOpened: false,
  readyToOpen: false,
  openedAt: null,
  body: undefined,
  ...over,
});

async function renderUs() {
  const { default: UsScreen } = await import('@/app/(app)/(tabs)/together');
  return render(createElement(UsScreen));
}

beforeEach(() => {
  (globalThis as any).__usScrollViews = [];
  pushSpy.mockClear();
  sendSqueezeSpy.mockClear();
  sendSqueezeSpy.mockResolvedValue(undefined);
  addMomentSpy.mockReset();
  loadForSpy.mockClear();
  addResponseSpy.mockClear();
  addResponseSpy.mockResolvedValue(true);
  mockResponses = [];
  mockSqueezeSending = false;
  mockLastSentAt = null;
  mockLetters = [];
  mockLettersLoading = false;
  mockLettersError = null;
  mockMomentsLoading = false;
  mockMomentsError = null;
  mockSpace = { name: 'Home', partnerName: 'June', relationshipStartDate: '2024-06-01' };
  // A default archive so shape tests have something to render.
  mockMoments = [makeMoment()];
});

// ─────────────────────────────────────────────────────────────────────────
// Honesty and safety. These are the reason this suite exists.
// ─────────────────────────────────────────────────────────────────────────

describe('Us honesty guards', () => {
  it('never leaks a sealed letter body, and never counts sealed letters as a badge', async () => {
    mockLetters = [makeLetter({ id: 'sealed-9', body: 'SECRET SEALED WORDS', sealedUntil: '2027-01-01T00:00:00.000Z' })];
    const { container } = await renderUs();
    expect(container.textContent).not.toContain('SECRET SEALED WORDS');
    // A count of what is sealed is a scoreboard. Nothing here counts.
    expect(container.textContent).not.toMatch(/\d+\s+sealed/i);
  });

  it('never prints a letter body on Us, sealed or not', async () => {
    // Us no longer prints a letter's caption at all, let alone its body. The
    // body lives behind the letter's own screen and its own seal.
    mockLetters = [makeLetter({ id: 'due', caption: 'The Lisbon one', sealedUntil: '2020-01-01T00:00:00.000Z', body: 'SECRET SEALED WORDS' })];
    const { container } = await renderUs();
    expect(container.textContent).not.toContain('SECRET SEALED WORDS');
    expect(screen.queryByText('The Lisbon one')).toBeNull();
  });

  it('a loading shelf looks like nothing, not like an empty one', async () => {
    mockLettersLoading = true;
    mockLetters = [];
    const { container } = await renderUs();
    expect(container.textContent).not.toMatch(/No letters|sealed/i);
  });

  it('a loading archive does not claim the sky is empty', async () => {
    mockMomentsLoading = true;
    mockMoments = [];
    await renderUs();
    // An empty sky and an unread one look identical otherwise, and the first
    // one tells the couple they have kept nothing.
    expect(screen.getByText('Opening your sky…')).toBeTruthy();
    expect(screen.queryByText('Keep a memory and it lights up here.')).toBeNull();
  });

  it('a failed read leaks no raw error on either shelf', async () => {
    mockLettersError = 'HTTP 500 at /v1/letters: token eyJhbGciOi';
    mockMomentsError = 'ECONNREFUSED 10.0.0.4:5432 password=hunter2';
    const { container } = await renderUs();
    expect(container.textContent).not.toContain('hunter2');
    expect(container.textContent).not.toContain('ECONNREFUSED');
    expect(container.textContent).not.toContain('eyJhbGciOi');
  });

  it('never polls: no repeating timer is armed on this screen', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    await renderUs();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('Us never saves a memory itself; it only reads and navigates', async () => {
    await renderUs();
    await press(screen.getByTestId('sky'));
    await press(screen.getByLabelText('Open Aquarium afternoon'));
    expect(addMomentSpy).not.toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/moment/[id]',
      params: { id: 'm1', at: '2026-06-21T11:00:00.000Z', returnTo: 'us' },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Shape: the sky is the interface. No list, no feed, no queue.
// ─────────────────────────────────────────────────────────────────────────

describe('Us is the sky', () => {
  it('gives the sky the press handler, so it is the interface and not a picture', async () => {
    await renderUs();
    // The sky is the primary surface here, so it must be full-bleed, take
    // touches, and stop hiding itself from a screen reader.
    const sky = screen.getByTestId('sky');
    expect(sky.getAttribute('data-immersive')).toBe('true');
    expect(sky.getAttribute('data-pressable')).toBe('true');
  });

  it('brings a memory out when the sky is tapped', async () => {
    await renderUs();
    // Nothing is open on arrival: the screen is the sky, and what you look at
    // is whatever you reach for.
    expect(screen.queryByText('Aquarium afternoon')).toBeNull();

    await press(screen.getByTestId('sky'));
    expect(screen.getByText('Aquarium afternoon')).toBeTruthy();
    // And the exchange comes with it, because that is the point of opening it.
    expect(screen.getByLabelText(/Say you were there/)).toBeTruthy();
  });

  it('loads the exchange for the memory that opened', async () => {
    await renderUs();
    await press(screen.getByTestId('sky'));
    expect(loadForSpy).toHaveBeenLastCalledWith('m1');
  });

  it('carries no page furniture at all', async () => {
    const { container } = await renderUs();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/See what.s here/);
    expect(text).not.toMatch(/More ways to connect/);
    expect(text).not.toMatch(/A little closer/);
    expect(text).not.toMatch(/Looking at one thing|or leave it/);
  });

  it('always offers the archive as a list, because a sky of dots is not for everyone', async () => {
    // A spatial field of sub-pixel dots is unusable with VoiceOver, with low
    // vision, or with a hand that shakes. This screen is not allowed to be
    // the only way into the archive.
    await renderUs();
    const list = screen.getByLabelText('See all memories as a list');
    await press(list);
    expect(pushSpy).toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });

  it('says once that the stars are days, then stops saying it', async () => {
    await renderUs();
    expect(screen.getByText('Tap the sky for something of yours.')).toBeTruthy();
    await press(screen.getByTestId('sky'));
    // The hint has done its job and is gone for good.
    expect(screen.queryByText('Tap the sky for something of yours.')).toBeNull();
  });

  it('a due letter is a quiet control, not a card above the fold', async () => {
    mockLetters = [makeLetter({ id: 'due', caption: 'The Lisbon one', sealedUntil: '2020-01-01T00:00:00.000Z' })];
    const { container } = await renderUs();
    // No banner, no overlay. The sky is the screen, so a letter is a small
    // control in the corner and nothing interrupts the field.
    expect(container.textContent).not.toContain('The Lisbon one');
    await press(screen.getByLabelText('A letter is ready to open'));
    expect(pushSpy).toHaveBeenCalledWith({ pathname: '/(app)/letter/[id]', params: { id: 'due' } });
  });

  it('an empty sky says what will light it up, and never looks broken', async () => {
    mockMoments = [];
    const { container } = await renderUs();
    expect(screen.getByText('Keep a memory and it lights up here.')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Nothing to look at|No memories yet/i);
  });
});

describe('Tapping the sky', () => {
  it('closes again, and goes back to the sky', async () => {
    await renderUs();
    await press(screen.getByTestId('sky'));
    expect(screen.getByText('Aquarium afternoon')).toBeTruthy();
    await press(screen.getByLabelText('Close this memory'));
    expect(screen.queryByText('Aquarium afternoon')).toBeNull();
    // The exchange is released with it rather than left loaded.
    expect(loadForSpy).toHaveBeenLastCalledWith(null);
  });

  it('adds you with one tap and no writing at all', async () => {
    await renderUs();
    await press(screen.getByTestId('sky'));
    await press(screen.getByLabelText(/Say you were there/));
    expect(addResponseSpy).toHaveBeenCalledTimes(1);
    const sent = addResponseSpy.mock.calls[0][0];
    expect(sent.kind).toBe('tap');
    expect(sent.body).toBeUndefined();
    expect(sent.momentId).toBe('m1');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Squeeze: still one tap, still safe, still no fake delivery claims.
// ─────────────────────────────────────────────────────────────────────────

describe('Squeeze stays tiny and safe', () => {
  it('sends in one tap, with no sheet in between', async () => {
    await renderUs();
    await press(screen.getByLabelText('Squeeze'));
    expect(sendSqueezeSpy).toHaveBeenCalledTimes(1);
    // No confirmation sheet, no modal: the press is the whole interaction.
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('offers no claim of delivery, ever', async () => {
    const { container } = await renderUs();
    expect(container.textContent).not.toMatch(/they (felt|received|saw)/i);
  });

  it('says Sent only when the context reports a real send', async () => {
    // `sendSqueeze` absorbs its own failures and returns nothing, so the
    // screen cannot infer success from the call. It reads `lastSentAt`,
    // which the context only sets once the send has actually happened. A
    // squeeze that failed must never leave this screen saying "Sent."
    const { rerender } = await renderUs();
    expect(screen.getByLabelText('Squeeze')).toBeTruthy();
    expect(screen.queryByText('Sent.')).toBeNull();

    await press(screen.getByLabelText('Squeeze'));
    expect(sendSqueezeSpy).toHaveBeenCalledTimes(1);
    // Still nothing claimed: the context has not reported a send.
    expect(screen.queryByText('Sent.')).toBeNull();

    mockLastSentAt = '2026-06-21T12:00:00.000Z';
    await act(async () => {
      rerender(createElement((await import('@/app/(app)/(tabs)/together')).default));
    });
    expect(screen.getByText('Sent.')).toBeTruthy();
  });

  it('clears the sent timer on unmount without leaking', async () => {
    vi.useFakeTimers();
    try {
      mockLastSentAt = '2026-06-21T12:00:00.000Z';
      const setSpy = vi.spyOn(globalThis, 'setTimeout');
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      const { unmount } = await renderUs();
      // A timer is armed to take the label back down...
      expect(setSpy).toHaveBeenCalled();
      // ...and unmounting takes it away rather than setting state later.
      expect(() => unmount()).not.toThrow();
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays disabled and says so while sending, and never claims delivery', async () => {
    mockSqueezeSending = true;
    await renderUs();
    const control = screen.getByLabelText('Squeeze');
    expect(control.getAttribute('aria-disabled')).toBe('true');
    expect(control.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Sending…')).toBeTruthy();
    // Never a claim that the other person received or felt it.
    expect(document.body.textContent).not.toMatch(/they (felt|received|saw)/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression: this screen once handed Reanimated's scroll handler to a plain
// ScrollView as `onScroll`, which threw on device. It now has no scroll
// handler at all, and the assertion is that it stays that way.
// ─────────────────────────────────────────────────────────────────────────

describe('Us scrolling', () => {
  it('attaches no scroll handler, so a scroll cannot throw', async () => {
    await renderUs();
    for (const view of (globalThis as any).__usScrollViews as { onScroll?: unknown }[]) {
      expect(view.onScroll).toBeUndefined();
    }
  });

  it('mounts and unmounts without a leak', async () => {
    const { unmount } = await renderUs();
    expect(() => unmount()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The exchange. This is the whole screen, so it carries the most weight:
// the cheapest way in has to work, and it has to work with no keyboard.
// ─────────────────────────────────────────────────────────────────────────

describe('The exchange on a memory', () => {
  it('adds you with one tap and no writing at all', async () => {
    await renderUs();
    await press(screen.getByTestId('sky'));
    await press(screen.getByLabelText(/Say you were there/));
    expect(addResponseSpy).toHaveBeenCalledTimes(1);
    const sent = addResponseSpy.mock.calls[0][0];
    // The cheapest response in the app. No body, no media, no sheet opened.
    expect(sent.kind).toBe('tap');
    expect(sent.body).toBeUndefined();
    expect(sent.mediaPreview).toBeUndefined();
    expect(sent.audioUri).toBeUndefined();
    expect(sent.momentId).toBe('m1');
    expect(sent.authorRole).toBe('you');
  });

  it('offers photo, voice and words, in that order, and nothing before a tap', async () => {
    await renderUs();
    await press(screen.getByTestId('sky'));
    // The tap is a real control, not a link into a composer: it is on the
    // screen, one press, done. That is the point of it.
    expect(screen.getByLabelText(/Say you were there/)).toBeTruthy();
    // The escalations are secondary and labelled as such.
    expect(screen.getByLabelText('Photo')).toBeTruthy();
    expect(screen.getByLabelText('Voice note')).toBeTruthy();
    expect(screen.getByLabelText('Words')).toBeTruthy();
  });

  it('shows what the other person has already said on this memory', async () => {
    mockResponses = [
      { id: 'r1', momentId: 'm1', authorId: 'u2', authorRole: 'partner', authorName: 'June', kind: 'word', body: 'this was the good one', mediaPreview: null, audioUri: null, createdAt: '2026-06-22T09:00:00.000Z' },
    ];
    await renderUs();
    await press(screen.getByTestId('sky'));
    expect(screen.getByText('June')).toBeTruthy();
    expect(screen.getByText('this was the good one')).toBeTruthy();
    // One thing, said once. No "1 new" counter, no unread badge.
    expect(screen.queryByText(/\b1\b.*\bnew\b/i)).toBeNull();
  });

  it('never tells the reader they are behind', async () => {
    // The old screen was a queue and implied a backlog. This one is a
    // single artifact, so there is nothing to be behind on.
    const { container } = await renderUs();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\bnew\b/i);
    expect(text).not.toMatch(/unread|pending|waiting for|still to/i);
    expect(text).not.toMatch(/\d+\s*(day|days)\s*ago.*due/i);
  });

  it('asks for nothing, in copy or in behaviour', async () => {
    const { container } = await renderUs();
    const text = container.textContent ?? '';
    // No obligation language, and nothing that behaves like a queue: no
    // counts of what is outstanding, no "unanswered", no due dates.
    expect(text).not.toMatch(/you (need|should|must|have) to/i);
    expect(text).not.toMatch(/unanswered|still to|due now|waiting on you/i);
    // The only instruction on the screen is the one that explains the sky.
    expect(text).toMatch(/Tap the sky for something of yours\./);
  });
});

describe('The draw', () => {
  it('never hands back the memory already open', async () => {
    // Tapping twice and getting the same thing twice reads as a broken
    // screen, so the open memory is excluded from the pool. With a
    // multi-memory archive this must hold every time, not usually.
    mockMoments = [
      makeMoment({ id: 'm1', title: 'One' }),
      makeMoment({ id: 'm2', title: 'Two', occurredAt: '2026-06-02T11:00:00.000Z' }),
      makeMoment({ id: 'm3', title: 'Three', occurredAt: '2026-06-03T11:00:00.000Z' }),
    ];
    await renderUs();
    let previous = '';
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await press(screen.getByTestId('sky'));
      const shown = ['One', 'Two', 'Three'].find((title) => screen.queryByText(title));
      expect(shown, 'a memory is always open').toBeTruthy();
      expect(shown, 'a repeat draw').not.toBe(previous);
      previous = shown as string;
    }
  });

  it('draws from everything kept, not only from a day', async () => {
    // The day field is a calendar camera that needs a year of history before
    // it means anything. With a young archive it is mostly empty, so a tap
    // that resolved to the day under the finger would open nothing at all.
    mockMoments = [
      makeMoment({ id: 'm1', title: 'Only one so far', occurredAt: '2026-06-21T11:00:00.000Z' }),
    ];
    await renderUs();
    await press(screen.getByTestId('sky'));
    // A single-memory archive is the degenerate case and it still opens.
    expect(screen.getByText('Only one so far')).toBeTruthy();
  });

  it('opens nothing, and says so, on an empty archive', async () => {
    mockMoments = [];
    const { container } = await renderUs();
    await press(screen.getByTestId('sky'));
    expect(container.textContent).not.toMatch(/Open this memory|Say you were there/);
  });
});
