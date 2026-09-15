import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

// Calm home: Pressables resolve press-state styles as unpressed; Keep toggle
// expanded state surfaces as aria-expanded so the progressive-disclosure
// contract is assertable in happy-dom.
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
    if (typeof props.accessibilityLabel === 'string') {
      next['aria-label'] = props.accessibilityLabel;
    }
    if (props.accessibilityState && typeof props.accessibilityState.expanded === 'boolean') {
      next['aria-expanded'] = props.accessibilityState.expanded ? 'true' : 'false';
    }
    if (typeof props.onPress === 'function') {
      next.onClick = props.onPress;
    }
    if (typeof props.onPressIn === 'function') {
      next.onMouseDown = props.onPressIn;
    }
    if (typeof props.onPressOut === 'function') {
      next.onMouseUp = props.onPressOut;
    }
    return next;
  }
  function createDiv(children: any, style: any, props: Record<string, any>) {
    const React = require('react');
    return React.createElement('div', { style: flattenStyle(style), ...withAriaProps(props) }, children);
  }
  function createSpan(children: any, style: any, props: Record<string, any>) {
    const React = require('react');
    return React.createElement('span', { style: flattenStyle(style), ...withAriaProps(props) }, children);
  }
  return {
    StyleSheet: {
      create: (styles: Record<string, any>) => styles,
      hairlineWidth: 1,
      absoluteFill: {},
      absoluteFillObject: {},
      flatten: flattenStyle,
    },
    View: (props: any) => {
      const { children, style, ...rest } = props;
      return createDiv(children, style, rest);
    },
    Text: (props: any) => {
      const { children, style, ...rest } = props;
      return createSpan(children, style, rest);
    },
    ScrollView: (props: any) => {
      const { children, style, contentContainerStyle, contentInsetAdjustmentBehavior, showsVerticalScrollIndicator, ...rest } = props;
      return createDiv(children, style, rest);
    },
    ActivityIndicator: (props: any) => {
      const { children, style, ...rest } = props;
      return createDiv(children, style, rest);
    },
    Pressable: (props: any) => {
      const { children, style, ...rest } = props;
      const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
      const content = typeof children === 'function' ? children({ pressed: false }) : children;
      return createDiv(content, resolved, rest);
    },
    TextInput: (props: any) => {
      const { children, style, value, onChangeText, placeholder, autoFocus, ...rest } = props;
      const React = require('react');
      return React.createElement('input', {
        style: flattenStyle(style),
        value: value ?? '',
        placeholder,
        autoFocus: autoFocus ? true : undefined,
        'data-autofocus': autoFocus ? 'true' : 'false',
        onChange: (event: any) => onChangeText?.(event.target.value),
        ...withAriaProps(rest),
      });
    },
    Modal: (props: any) => {
      const { children, visible, ...rest } = props;
      if (visible === false) {
        return null;
      }
      return createDiv(children, undefined, rest);
    },
    KeyboardAvoidingView: (props: any) => {
      const { children, style, ...rest } = props;
      return createDiv(children, style, rest);
    },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    Platform: { OS: 'ios', select: (obj: any) => obj.ios },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(false),
      addEventListener: () => ({ remove: () => {} }),
    },
  };
});

const pushSpy = vi.fn();
const replaceSpy = vi.fn();
const reloadLettersSpy = vi.fn(async () => {});
const reloadQuestionSpy = vi.fn(async () => {});
const refreshMomentsSpy = vi.fn(async () => {});
const sendSqueezeSpy = vi.fn(async () => {});
const addMomentSpy = vi.fn();

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: pushSpy, back: vi.fn(), replace: replaceSpy, dismissTo: vi.fn() }),
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

vi.mock('expo-blur', () => ({
  BlurView: (props: any) => {
    const React = require('react');
    return React.createElement('div', { 'aria-label': 'Blur background', style: props.style });
  },
}));

vi.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a' } },
  requestRecordingPermissionsAsync: vi.fn(async () => ({ granted: mockAudioGranted })),
  setAudioModeAsync: (...args: any[]) => mockSetAudioMode(...args),
  useAudioRecorder: (options: any, onStatus: any) => {
    mockRecorderOptions = options;
    mockAudioStatusHandler = onStatus;
    return {
      prepareToRecordAsync: (...args: any[]) => mockPrepareToRecord(...args),
      record: (...args: any[]) => mockRecordStart(...args),
      stop: (...args: any[]) => mockStopRecording(...args),
    };
  },
  useAudioRecorderState: () => ({
    canRecord: true,
    isRecording: mockAudioActive,
    durationMillis: mockAudioDuration,
    mediaServicesDidReset: false,
    url: null,
    metering: mockAudioMetering,
  }),
}));

vi.mock('@/components/media/voice-recorder', () => ({
  VoiceRecorder: ({ onRecorded }: { onRecorded: (uri: string) => void }) =>
    createElement('button', { 'aria-label': 'Record voice', onClick: () => onRecorded('file:///voice.m4a') }, 'Record voice'),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/components/space/space-avatar-button', () => ({
  SpaceAvatarButton: () => createElement('div', { 'aria-label': 'Shared avatar' }),
}));

vi.mock('@/features/letters/letters-context', () => ({
  useLetters: () => ({
    letters: mockLetters,
    isLoading: mockLettersLoading,
    error: mockLettersError,
    reload: reloadLettersSpy,
  }),
}));

vi.mock('@/features/question/question-context', () => ({
  useQuestion: () => ({
    state: mockQuestion,
    isLoading: mockQuestionLoading,
    error: mockQuestionError,
    reload: reloadQuestionSpy,
  }),
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: mockMoments,
    isLoading: mockMomentsLoading,
    error: mockMomentsError,
    refresh: refreshMomentsSpy,
    addMoment: addMomentSpy,
  }),
}));

vi.mock('@/features/squeeze/squeeze-context', () => ({
  useSqueeze: () => ({ sendSqueeze: sendSqueezeSpy, isSending: mockSqueezeSending }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: mockSpace, status: 'ready' }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, variant, onPress, accessibilityState }: { label: string; variant?: string; onPress?: () => void; accessibilityState?: { expanded?: boolean } }) =>
    createElement('button', {
      'aria-label': label,
      'data-variant': variant ?? 'primary',
      ...(accessibilityState && typeof accessibilityState.expanded === 'boolean'
        ? { 'aria-expanded': accessibilityState.expanded ? 'true' : 'false' }
        : {}),
      onClick: onPress,
    }, label),
}));

let mockSpace: any = null;
let mockLetters: Record<string, any>[] = [];
let mockLettersLoading = false;
let mockLettersError: string | null = null;
let mockQuestion: Record<string, any> | null = null;
let mockQuestionLoading = false;
let mockQuestionError: string | null = null;
let mockMoments: Record<string, any>[] = [];
let mockMomentsLoading = false;
let mockMomentsError: string | null = null;
let mockSqueezeSending = false;
let mockAudioGranted = true;
let mockAudioActive = false;
let mockAudioDuration = 0;
let mockAudioMetering: number | undefined = -20;
let mockAudioStatusHandler: ((status: any) => void) | null = null;
let mockRecorderOptions: any = null;
const mockPrepareToRecord = vi.fn(async () => {});
const mockRecordStart = vi.fn(() => {
  mockAudioActive = true;
});
const mockStopRecording = vi.fn(async () => {
  mockAudioActive = false;
});
const mockSetAudioMode = vi.fn(async () => {});

function makeLetter(overrides: Record<string, any> = {}) {
  return {
    id: 'letter-1',
    authorRole: 'partner',
    authorName: 'Alex',
    caption: 'For a rainy day',
    body: undefined,
    sealedUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    isOpened: false,
    readyToOpen: false,
    openedAt: null,
    ...overrides,
  };
}

function makeQuestion(overrides: Record<string, any> = {}) {
  return {
    weekKey: '2026-W32',
    questionId: 1,
    question: 'What small thing made today good?',
    yourAnswer: null,
    yourAnswerUpdatedAt: null,
    partnerAnswered: false,
    partnerAnswer: null,
    partnerName: 'Alex',
    revealed: false,
    ...overrides,
  };
}

function makeMoment(overrides: Record<string, any> = {}) {
  return {
    id: 'm-1',
    type: 'note',
    title: 'Picnic',
    body: 'Warm bread by the lake.',
    occurredAt: '2026-02-08T09:15:00.000Z',
    createdAt: '2026-02-08T09:16:00.000Z',
    authorId: 'user_partner',
    authorRole: 'partner',
    authorName: 'Alex',
    isOwn: false,
    mediaPreview: undefined,
    audioUri: null,
    mediaId: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockLetters = [];
  mockLettersLoading = false;
  mockLettersError = null;
  mockQuestion = null;
  mockQuestionLoading = false;
  mockQuestionError = null;
  mockSpace = null;
  mockMoments = [];
  mockMomentsLoading = false;
  mockMomentsError = null;
  mockSqueezeSending = false;
  mockAudioGranted = true;
  mockAudioActive = false;
  mockAudioDuration = 0;
  mockAudioMetering = -20;
  mockAudioStatusHandler = null;
  mockRecorderOptions = null;
  mockPrepareToRecord.mockClear();
  mockRecordStart.mockClear();
  mockStopRecording.mockClear();
  mockSetAudioMode.mockClear();
  pushSpy.mockClear();
  replaceSpy.mockClear();
  reloadLettersSpy.mockClear();
  reloadQuestionSpy.mockClear();
  refreshMomentsSpy.mockClear();
  sendSqueezeSpy.mockClear();
  sendSqueezeSpy.mockResolvedValue(undefined);
  addMomentSpy.mockReset();
  addMomentSpy.mockResolvedValue({ id: 'saved-1', occurredAt: '2026-05-01T12:00:00.000Z' });
});

async function renderUs() {
  const { default: UsScreen } = await import('@/app/(app)/(tabs)/together');
  return render(createElement(UsScreen));
}

async function expandKeep() {
  fireEvent.click(screen.getByLabelText('Keep a memory'));
  expect(screen.getByLabelText('Keep a memory').getAttribute('aria-expanded')).toBe('true');
}

describe('Us toolbar', () => {
  it('shows compact Us title and shared avatar without large subtitle or create icon', async () => {
    await renderUs();
    expect(screen.getByText('Us')).toBeTruthy();
    expect(screen.getByLabelText('Shared avatar')).toBeTruthy();
    expect(screen.queryByText('The shared things, yours and theirs.')).toBeNull();
    expect(screen.queryByText('Together')).toBeNull();
    expect(screen.queryByLabelText(/Write a letter/i)).toBeNull();
    expect(screen.queryByLabelText(/Capture a moment/i)).toBeNull();
  });
});

describe('Calm home default: four named actions, no trio, no focal', () => {
  it('offers Squeeze, Keep a memory, Letters, Reflection with capture hidden', async () => {
    const { container } = await renderUs();
    expect(screen.getByText('Squeeze')).toBeTruthy();
    const keep = screen.getByLabelText('Keep a memory');
    expect(keep).toBeTruthy();
    expect(keep.getAttribute('aria-expanded')).toBe('false');
    expect(keep.getAttribute('data-variant')).toBe('secondary');
    expect(screen.getByText('Letters')).toBeTruthy();
    expect(screen.getByText('Reflection')).toBeTruthy();
    // Capture trio hidden until asked.
    expect(screen.queryByText('Photo')).toBeNull();
    expect(screen.queryByText('Note')).toBeNull();
    expect(screen.queryByText('Voice')).toBeNull();
    expect(screen.queryByLabelText('Keep a photo memory')).toBeNull();
    expect(screen.queryByLabelText('Keep a note memory')).toBeNull();
    expect(screen.queryByLabelText('Keep a voice memory')).toBeNull();
    expect(screen.queryByText('Kept in Memories — voice records there')).toBeNull();
    // No focal hero: no question text, no huge CTA, no memory duplicate, no invitation.
    expect(screen.queryByText('Answer together')).toBeNull();
    expect(screen.queryByText('Open letters')).toBeNull();
    expect(screen.queryByText('View memory')).toBeNull();
    expect(screen.queryByText('Keep your first memory')).toBeNull();
    expect(screen.queryByText('What small thing made today good?')).toBeNull();
    expect(screen.queryByText('A letter is ready')).toBeNull();
    expect(screen.queryByText('Latest memory')).toBeNull();
    expect(container.textContent).not.toMatch(/A photo, note, or voice note to start your story/);
  });

  it('has no hidden clickable capture while collapsed', async () => {
    await renderUs();
    const pushCount = pushSpy.mock.calls.length;
    // Collapsed trio renders nothing clickable: labels absent, texts absent.
    expect(screen.queryByLabelText('Keep a photo memory')).toBeNull();
    expect(screen.queryByLabelText('Keep a note memory')).toBeNull();
    expect(screen.queryByLabelText('Keep a voice memory')).toBeNull();
    expect(pushSpy.mock.calls.length).toBe(pushCount);
  });

  it('keeps Letters and Reflection entrances always visible with quiet chevrons', async () => {
    const { container } = await renderUs();
    fireEvent.click(screen.getByText('Letters'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/letters');
    fireEvent.click(screen.getByText('Reflection'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/question');
    expect(container.querySelectorAll('[data-icon="chevron-forward"]').length).toBe(2);
  });
});

describe('Keep a memory toggle then capture', () => {
  it('expands inline trio, collapses via the same toggle', async () => {
    await renderUs();
    expect(screen.queryByLabelText('Keep a photo memory')).toBeNull();
    await expandKeep();
    expect(screen.getByLabelText('Keep a photo memory')).toBeTruthy();
    expect(screen.getByLabelText('Keep a note memory')).toBeTruthy();
    expect(screen.getByLabelText('Keep a voice memory')).toBeTruthy();
    expect(screen.getByText('Kept in Memories — voice records there')).toBeTruthy();
    // Explicit hide via the same toggle.
    fireEvent.click(screen.getByLabelText('Keep a memory'));
    expect(screen.getByLabelText('Keep a memory').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Keep a photo memory')).toBeNull();
    expect(screen.queryByText('Kept in Memories — voice records there')).toBeNull();
  });

  it('Photo, Note, and Voice all route to Memories composer with no local sheets', async () => {
    await renderUs();
    await expandKeep();
    fireEvent.click(screen.getByText('Photo'));
    expect(pushSpy).toHaveBeenLastCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'photos' },
    });

    fireEvent.click(screen.getByText('Note'));
    expect(pushSpy).toHaveBeenLastCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'note' },
    });
    expect(screen.queryByText('Keep a note')).toBeNull();

    fireEvent.click(screen.getByText('Voice'));
    expect(pushSpy).toHaveBeenLastCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'voice' },
    });
    expect(addMomentSpy).not.toHaveBeenCalled();
  });

  it('Voice tap routes to Memories composer without starting the mic', async () => {
    await renderUs();
    await expandKeep();
    fireEvent.click(screen.getByText('Voice'));
    expect(pushSpy).toHaveBeenLastCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'voice' },
    });
    expect(screen.queryByLabelText('Recording voice note. Release to finish.')).toBeNull();
    expect(screen.queryByLabelText('Voice note ready to send.')).toBeNull();
    expect(addMomentSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('Us never saves directly — capture owns no overlay or sheet', async () => {
    await renderUs();
    await expandKeep();
    expect(screen.queryByLabelText('Voice note ready to send.')).toBeNull();
    expect(screen.queryByText('Keep a note')).toBeNull();
    expect(addMomentSpy).not.toHaveBeenCalled();
  });
});

describe('Stable ready-row signals, never sealed bodies', () => {
  it('Letters row shows Ready to open for a ready letter without exposing body', async () => {
    mockLetters = [
      makeLetter({
        id: 'ready-1',
        caption: 'For a rainy day',
        body: 'SECRET SEALED WORDS',
        sealedUntil: new Date(Date.now() - 1000).toISOString(),
      }),
    ];
    const { container } = await renderUs();
    expect(screen.getByText('Ready to open')).toBeTruthy();
    // No duplicate CTA, no caption leak as hero, never the sealed body.
    expect(screen.queryByText('Open letters')).toBeNull();
    expect(screen.queryByText('For a rainy day')).toBeNull();
    expect(container.textContent).not.toContain('SECRET SEALED WORDS');
    fireEvent.click(screen.getByText('Letters'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/letters');
  });

  it('Letters row hides Ready to open when nothing is ready', async () => {
    mockLetters = [makeLetter({ id: 'future-1', sealedUntil: new Date(Date.now() + 86400000).toISOString() })];
    await renderUs();
    expect(screen.queryByText('Ready to open')).toBeNull();
    expect(screen.getByText('Letters')).toBeTruthy();
  });

  it('Reflection row maps This week, Waiting, Answers are ready with no question-text CTA', async () => {
    // Unanswered -> This week.
    mockQuestion = makeQuestion();
    const first = await renderUs();
    expect(screen.getByText('This week')).toBeTruthy();
    expect(screen.queryByText('What small thing made today good?')).toBeNull();
    expect(screen.queryByText('Answer together')).toBeNull();
    first.unmount();

    // Answered but not revealed -> Waiting for your partner.
    mockQuestion = makeQuestion({ yourAnswer: 'Coffee in bed.', partnerAnswered: false, revealed: false });
    const second = await renderUs();
    expect(screen.getByText('Waiting for your partner')).toBeTruthy();
    expect(screen.queryByText('What small thing made today good?')).toBeNull();
    second.unmount();

    // Both answered -> Answers are ready.
    mockQuestion = makeQuestion({ yourAnswer: 'Coffee.', partnerAnswered: true, revealed: true, partnerAnswer: 'Tea.' });
    await renderUs();
    expect(screen.getByText('Answers are ready')).toBeTruthy();
    fireEvent.click(screen.getByText('Reflection'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/question');
  });

  it('memories never render as a focal duplicate', async () => {
    mockQuestion = makeQuestion({ yourAnswer: 'done' });
    mockMoments = [makeMoment({ id: 'm-9', title: 'Picnic', body: 'Warm bread.' })];
    const { container } = await renderUs();
    expect(screen.queryByText('Picnic')).toBeNull();
    expect(screen.queryByText('View memory')).toBeNull();
    expect(container.textContent).not.toContain('Warm bread.');
  });
});

describe('Loading and error honesty in row areas', () => {
  it('letters loading shows inline Loading without false Ready', async () => {
    mockLettersLoading = true;
    await renderUs();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    expect(screen.queryByText('Ready to open')).toBeNull();
  });

  it('letters error shows concise retry without leaking raw error', async () => {
    mockLettersError = 'Network request failed: ECONNREFUSED 10.0.0.1';
    const { container } = await renderUs();
    expect(screen.getByText(/aren't loading/)).toBeTruthy();
    expect(container.textContent).not.toContain('ECONNREFUSED');
    fireEvent.click(screen.getByText('Try again'));
    expect(reloadLettersSpy).toHaveBeenCalledTimes(1);
    // Row entrance still stable.
    fireEvent.click(screen.getByText('Letters'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/letters');
  });

  it('question error shows concise retry without leaking raw error', async () => {
    mockQuestionError = '500 Internal Server Error stacktrace';
    const { container } = await renderUs();
    expect(screen.getByText(/isn't loading/)).toBeTruthy();
    expect(container.textContent).not.toContain('stacktrace');
    fireEvent.click(screen.getByText('Try again'));
    expect(reloadQuestionSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Reflection'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/question');
  });

  it('question loading shows inline Loading with Reflection still reachable', async () => {
    mockQuestionLoading = true;
    await renderUs();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    fireEvent.click(screen.getByText('Reflection'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/question');
  });
});

describe('Squeeze stays tiny and safe', () => {
  it('sends without counters and shows safe message on failure', async () => {
    sendSqueezeSpy.mockRejectedValueOnce(new Error('boom raw stack'));
    const { container } = await renderUs();
    fireEvent.click(screen.getByLabelText('Send a squeeze to your partner'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sendSqueezeSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Couldn't send the squeeze. Try again.")).toBeTruthy();
    expect(container.textContent).not.toContain('boom raw stack');
    expect(container.textContent).not.toMatch(/\d+ squeeze/i);
  });
});
