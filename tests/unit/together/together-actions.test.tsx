import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

// Calm home: press-state styles resolve as unpressed; Keep toggle expanded
// surfaces as aria-expanded.
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
    isLoading: false,
    error: null,
    reload: reloadLettersSpy,
  }),
}));

vi.mock('@/features/question/question-context', () => ({
  useQuestion: () => ({
    state: mockQuestion,
    isLoading: false,
    error: null,
    reload: vi.fn(async () => {}),
  }),
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: mockMoments,
    isLoading: false,
    error: null,
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

// Expose the calm hierarchy: Keep toggle is secondary with expanded state;
// Letters/Reflection are quiet Pressable rows (not Buttons).
vi.mock('@/components/ui/button', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/ui/button')>();
  return {
    ...original,
    Button: ({ label, variant, onPress, accessibilityState }: { label: string; variant?: string; onPress?: () => void; accessibilityState?: { expanded?: boolean } }) =>
      createElement(
        'button',
        {
          'data-variant': variant ?? 'primary',
          'aria-label': label,
          ...(accessibilityState && typeof accessibilityState.expanded === 'boolean'
            ? { 'aria-expanded': accessibilityState.expanded ? 'true' : 'false' }
            : {}),
          onClick: onPress,
        },
        label
      ),
  };
});

let mockSpace: any = null;
let mockLetters: Record<string, any>[] = [];
let mockQuestion: Record<string, any> | null = null;
let mockMoments: Record<string, any>[] = [];
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
    sealedUntil: new Date(Date.now() - 1000).toISOString(),
    createdAt: new Date().toISOString(),
    isOpened: false,
    readyToOpen: true,
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
    ...overrides,
  };
}

beforeEach(() => {
  mockLetters = [];
  mockQuestion = null;
  mockSpace = null;
  mockMoments = [];
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

describe('Us calm hierarchy', () => {
  it('defaults to Squeeze, secondary Keep toggle, and quiet Letters/Reflection rows with no trio', async () => {
    mockQuestion = makeQuestion({ yourAnswer: 'done' });
    mockMoments = [makeMoment()];
    const { container } = await renderUs();

    // No primary focal CTA.
    expect(container.querySelector('button[data-variant="primary"]')).toBeNull();
    expect(screen.queryByText('Answer together')).toBeNull();
    expect(screen.queryByText('Open letters')).toBeNull();
    expect(screen.queryByText('View memory')).toBeNull();

    // Single secondary Keep toggle, collapsed.
    const keep = container.querySelector('button[aria-label="Keep a memory"]');
    expect(keep?.getAttribute('data-variant')).toBe('secondary');
    expect(keep?.getAttribute('aria-expanded')).toBe('false');

    // Capture trio hidden until asked.
    expect(screen.queryByLabelText('Keep a photo memory')).toBeNull();
    expect(screen.queryByLabelText('Keep a note memory')).toBeNull();
    expect(screen.queryByLabelText('Keep a voice memory')).toBeNull();

    // Quiet rows: body text + chevron, not accent Buttons.
    for (const label of ['Letters', 'Reflection']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
      expect(container.querySelector(`button[aria-label="${label}"]`)).toBeNull();
    }
    expect(container.querySelectorAll('[data-icon="chevron-forward"]').length).toBe(2);
    // Memories never duplicate as focal.
    expect(screen.queryByText('Picnic')).toBeNull();
  });

  it('expands chunky keep targets with glyphs, 64px height, 44px width', async () => {
    const { container } = await renderUs();
    fireEvent.click(screen.getByLabelText('Keep a memory'));
    expect(screen.getByLabelText('Keep a memory').getAttribute('aria-expanded')).toBe('true');

    const keeps: Array<[string, string, string]> = [
      ['Keep a photo memory', 'Photo', 'camera'],
      ['Keep a note memory', 'Note', 'pencil'],
      ['Keep a voice memory', 'Voice', 'mic'],
    ];
    for (const [a11y, label, icon] of keeps) {
      const target = screen.getByLabelText(a11y);
      expect(target).toBeTruthy();
      expect(target.textContent).toContain(label);
      expect(container.querySelector(`button[aria-label="${label}"]`)).toBeNull();
      const iconEl = container.querySelector(`[data-icon="${icon}"]`);
      expect(iconEl).toBeTruthy();
      const minHeight = (target as HTMLElement).style.minHeight;
      expect(minHeight).toMatch(/64/);
      const minWidth = (target as HTMLElement).style.minWidth;
      expect(minWidth).toMatch(/44/);
    }
    expect(screen.getByText('Kept in Memories — voice records there')).toBeTruthy();
  });

  it('ready letter signals Ready to open in the Letters row with a stable entrance', async () => {
    mockLetters = [makeLetter()];
    const { container } = await renderUs();
    expect(screen.getByText('Ready to open')).toBeTruthy();
    expect(screen.queryByText('Open letters')).toBeNull();
    const row = screen.getByLabelText('Letters');
    expect(row).toBeTruthy();
    expect(container.querySelector('button[aria-label="Letters"]')).toBeNull();
    fireEvent.click(screen.getByText('Letters'));
    expect(pushSpy).toHaveBeenCalledWith('/(app)/letters');
  });

  it('question maps to This week in the Reflection row with a stable entrance', async () => {
    mockQuestion = makeQuestion();
    const { container } = await renderUs();
    expect(screen.getByText('This week')).toBeTruthy();
    expect(screen.queryByText('Answer together')).toBeNull();
    expect(screen.queryByText('What small thing made today good?')).toBeNull();
    expect(screen.getByLabelText('Reflection')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Reflection"]')).toBeNull();
  });

  it('empty home has no primary and still offers capture only after expansion', async () => {
    const { container } = await renderUs();
    expect(container.querySelector('button[data-variant="primary"]')).toBeNull();
    expect(screen.queryByLabelText('Keep a photo memory')).toBeNull();
    fireEvent.click(screen.getByLabelText('Keep a memory'));
    for (const a11y of ['Keep a photo memory', 'Keep a note memory', 'Keep a voice memory']) {
      expect(screen.getByLabelText(a11y)).toBeTruthy();
    }
  });

  it('voice routes to Memories composer without starting the mic or saving', async () => {
    await renderUs();
    fireEvent.click(screen.getByLabelText('Keep a memory'));
    fireEvent.click(screen.getByLabelText('Keep a voice memory'));
    expect(pushSpy).toHaveBeenCalledWith({
      pathname: '/(app)/(tabs)/(memories)',
      params: { compose: 'voice' },
    });
    expect(screen.queryByLabelText('Recording voice note. Release to finish.')).toBeNull();
    expect(screen.queryByLabelText('Voice note ready to send.')).toBeNull();
    expect(addMomentSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});

describe('Us honesty guards', () => {
  it('never leaks a sealed body and never shows counts', async () => {
    mockLetters = [
      makeLetter({ id: 'sealed-9', body: 'SECRET SEALED WORDS', caption: 'For later', sealedUntil: new Date(Date.now() + 86400000).toISOString() }),
    ];
    mockQuestion = makeQuestion({ yourAnswer: 'done' });
    const { container } = await renderUs();
    expect(container.textContent).not.toContain('SECRET SEALED WORDS');
    expect(container.textContent).not.toMatch(/sealed/i);
  });

  it('uses no repeating timer for readiness', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    await renderUs();
    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
  });

  it('squeeze shows sending state and stays disabled while sending', async () => {
    mockSqueezeSending = true;
    const { container } = await renderUs();
    expect(screen.getByText('Sending…')).toBeTruthy();
    const pill = screen.getByLabelText('Send a squeeze to your partner') as HTMLElement;
    expect(pill.style.minHeight).toMatch(/44/);
    expect(pill.style.minWidth).toMatch(/44/);
    expect(pill.style.borderRadius).toMatch(/999/);
    expect(pill.style.alignSelf).toMatch(/center/);
    expect(container.querySelector('[data-icon="heart"]')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Send a squeeze to your partner'));
    expect(sendSqueezeSpy).not.toHaveBeenCalled();
  });
});
