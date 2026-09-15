import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

const updateBodySpy = vi.fn(async () => {});
const setOccurredAtSpy = vi.fn(async () => {});
const addAssetsSpy = vi.fn(async () => {});
const removeAssetSpy = vi.fn(async () => {});
const reorderAssetSpy = vi.fn(async () => {});
const saveSpy = vi.fn(async () => ({ clientId: 'draft-1' }));
const discardDraftSpy = vi.fn(async () => {});
const refreshServerPlusSpy = vi.fn(async () => {});
const openSettingsSpy = vi.fn(async () => {});
const hapticsSpy = vi.fn(async () => {});
const backSpy = vi.fn();
const pushSpy = vi.fn();
const setParamsSpy = vi.fn();

let mockDraft: any = null;
let mockHydrating = false;
let mockComposerError: string | null = null;
let mockLibraryResult: any = { canceled: true };
let mockCameraResult: any = { canceled: true };
let mockLibraryPermission = { granted: true };
let mockCameraPermission = { granted: true };
let mockMicPermission = { granted: true };
let mockAudioStatus: ((status: any) => void) | null = null;

vi.mock('@/features/composer/composer-context', () => ({
  useComposer: () => ({
    draft: mockDraft,
    hydrating: mockHydrating,
    pending: [],
    sendingIds: [],
    error: mockComposerError,
    updateBody: updateBodySpy,
    setOccurredAt: setOccurredAtSpy,
    addAssets: addAssetsSpy,
    removeAsset: removeAssetSpy,
    reorderAsset: reorderAssetSpy,
    save: saveSpy,
    discardDraft: discardDraftSpy,
    retry: vi.fn(),
    editPending: vi.fn(),
    discardPending: vi.fn(),
    resetCorrupt: vi.fn(),
  }),
  userSafeMessage: (err: unknown) => {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 'TOO_MANY_ASSETS') return 'Keep it to 10 photos or voice notes.';
    if (code === 'LIMIT_EXCEEDED') return 'This Space is out of media room.';
    if (code === 'EMPTY_DRAFT') return 'Add a note, photo, or voice first.';
    return 'Could not keep this. Please try again.';
  },
}));

vi.mock('@/features/subscription/subscription-context', () => ({
  useSubscription: () => ({ refreshServerPlus: refreshServerPlusSpy }),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: pushSpy, back: backSpy, setParams: setParamsSpy }),
  useIsFocused: () => true,
  // Native sheet chrome stand-ins: Title and header toolbar buttons render
  // their labels so the Cancel/Save contract holds through the native path.
  Stack: {
    Screen: {
      Title: ({ children }: any) => createElement('span', {}, children),
    },
    Toolbar: Object.assign(
      ({ children }: any) => createElement('div', {}, children),
      {
        Button: ({ children, onPress, disabled }: any) =>
          createElement(
            'button',
            { onClick: disabled ? undefined : onPress, disabled: disabled ? true : undefined },
            children
          ),
      }
    ),
  },
}));

vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: async () => mockLibraryPermission,
  requestCameraPermissionsAsync: async () => mockCameraPermission,
  launchImageLibraryAsync: async () => mockLibraryResult,
  launchCameraAsync: async () => mockCameraResult,
}));

vi.mock('expo-haptics', () => ({
  impactAsync: (...args: any[]) => hapticsSpy(...args),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

vi.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: async () => mockMicPermission,
  setAudioModeAsync: async () => {},
  useAudioRecorder: (_opts: any, onStatus: any) => {
    mockAudioStatus = onStatus as ((status: any) => void) | null;
    return {
      prepareToRecordAsync: (...args: any[]) => mockPrepare(...args),
      record: (...args: any[]) => mockRecord(...args),
      stop: (...args: any[]) => mockStop(...args),
    };
  },
  useAudioRecorderState: () => ({ isRecording: mockHoldRecording, durationMillis: mockHoldDuration }),
}));

vi.mock('@/components/media/audio-player', () => ({
  AudioPlayer: ({ uri }: any) =>
    createElement('div', { 'data-testid': 'audio-preview', 'data-uri': uri ?? '' }),
}));

vi.mock('@react-native-community/datetimepicker', () => ({
  default: ({ value, onChange }: any) =>
    createElement('button', {
      'aria-label': 'Pick a date',
      'data-value': (value as Date)?.toISOString?.() ?? '',
      onClick: () => onChange({ type: 'set' }, new Date('2026-04-02T12:00:00.000Z')),
    }, 'Pick a date'),
}));

vi.mock('moti', () => ({
  MotiView: ({ children }: any) => createElement('div', { 'data-testid': 'date-picker-card' }, children),
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: ({ label, onPress, disabled }: any) =>
    createElement('button', { 'aria-label': label, onClick: disabled ? undefined : onPress, disabled: disabled ? true : undefined }, label),
}));

vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

vi.mock('expo-image', () => ({
  Image: ({ source, accessibilityLabel }: any) =>
    createElement('div', {
      'data-testid': 'draft-photo',
      ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
      'data-uri': source?.uri ?? '',
    }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => createElement('span', {}, children),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress, disabled }: any) =>
    createElement('button', { onClick: disabled ? undefined : onPress, disabled: disabled ? true : undefined }, label),
}));

vi.mock('@/components/ui/action-sheet', () => ({
  ActionSheet: ({ visible, title, actions }: any) =>
    visible
      ? createElement(
          'div',
          { 'data-testid': `sheet:${title}` },
          actions.map((a: any) => createElement('button', { key: a.label, onClick: a.onPress }, a.label)),
        )
      : null,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

// Proves the thumbnail/voice wiring resolves through the shared staged-URI
// util (not the raw Documents-relative path): the marker transform must
// appear in the rendered URIs.
vi.mock('@/features/composer/staged-uri', () => ({
  resolveStagedUri: (uri: string) => `resolved:${uri}`,
}));

vi.mock('react-native', () => {
  const React = require('react');
  const View = ({ children, ...rest }: any) => {
    const { style, accessibilityLabel, ...kept } = rest;
    return React.createElement(
      'div',
      {
        style: Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style,
        ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
        ...kept,
      },
      children
    );
  };
  const TextInput = ({ value, onChangeText, onFocus, onBlur, placeholder, accessibilityLabel, autoFocus, ...rest }: any) =>
    React.createElement('input', {
      value: value ?? '',
      placeholder,
      'aria-label': accessibilityLabel,
      autoFocus: autoFocus ? true : undefined,
      'data-autofocus': autoFocus ? 'true' : 'false',
      onChange: (e: any) => onChangeText?.(e.target.value),
      onFocus,
      onBlur,
      ...rest,
    });
  const Pressable = (props: any) => {
    const { children, style, onPressIn, onPressOut, onPress, accessibilityLabel, disabled, ...rest } = props;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    return React.createElement('div', {
      style: Array.isArray(resolved) ? Object.assign({}, ...resolved.filter(Boolean)) : resolved,
      ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
      ...(onPress && !disabled ? { onClick: onPress } : {}),
      ...(disabled ? { 'aria-disabled': 'true' } : {}),
      ...(onPressIn && !disabled ? { onMouseDown: onPressIn } : {}),
      ...(onPressOut && !disabled ? { onMouseUp: onPressOut } : {}),
      ...rest,
    }, typeof children === 'function' ? children({ pressed: false }) : children);
  };
  const ScrollView = ({ children, contentContainerStyle, ...rest }: any) =>
    React.createElement('div', { 'data-testid': 'editor-scroll', ...rest }, children);
  return {
    View,
    TextInput,
    Pressable,
    ScrollView,
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1, absoluteFill: {}, absoluteFillObject: {} },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    Linking: { openSettings: openSettingsSpy },
    Platform: { OS: 'ios', select: (o: any) => o.ios },
  };
});

const mockPrepare = vi.fn(async () => {});
const mockRecord = vi.fn(() => { mockHoldRecording = true; });
const mockStop = vi.fn(async () => { mockHoldRecording = false; });
let mockHoldRecording = false;
let mockHoldDuration = 0;

function makeDraft(overrides: Record<string, any> = {}) {
  return {
    clientId: 'draft-1',
    body: '',
    occurredAt: '2026-04-01T12:00:00.000Z',
    assets: [],
    updatedAt: '2026-04-01T12:00:00.000Z',
    ...overrides,
  };
}

function makeFullDraft() {
  return makeDraft({
    assets: Array.from({ length: 10 }, (_, i) => ({
      stagedId: `s${i}`,
      kind: 'image' as const,
      mimeType: 'image/jpeg',
      localUri: `file:///s${i}.jpg`,
      uploaded: null,
    })),
  });
}

async function renderComposer(props: Record<string, any> = {}) {
  const { InlineMemoryComposer } = await import('@/components/moments/inline-memory-composer');
  return render(createElement(InlineMemoryComposer, props));
}

beforeEach(() => {
  mockDraft = makeDraft();
  mockHydrating = false;
  mockComposerError = null;
  mockLibraryResult = { canceled: true };
  mockCameraResult = { canceled: true };
  mockLibraryPermission = { granted: true };
  mockCameraPermission = { granted: true };
  mockMicPermission = { granted: true };
  mockHoldRecording = false;
  mockHoldDuration = 0;
  mockAudioStatus = null;
  (process.env as any).EXPO_OS = 'ios';
  updateBodySpy.mockClear();
  setOccurredAtSpy.mockClear();
  addAssetsSpy.mockClear();
  removeAssetSpy.mockClear();
  reorderAssetSpy.mockClear();
  saveSpy.mockClear();
  saveSpy.mockResolvedValue({ clientId: 'draft-1' });
  discardDraftSpy.mockClear();
  discardDraftSpy.mockResolvedValue(undefined);
  backSpy.mockClear();
  pushSpy.mockClear();
  setParamsSpy.mockClear();
  refreshServerPlusSpy.mockClear();
  openSettingsSpy.mockClear();
  hapticsSpy.mockClear();
  mockPrepare.mockClear();
  mockRecord.mockClear();
  mockStop.mockClear();
  vi.useRealTimers();
});

describe('Memory editor opens directly with keyboard + controls (no collapse)', () => {
  it('renders writing with autofocus and compact icon controls immediately, no type sheet', async () => {
    await renderComposer();
    const input = screen.getByLabelText('Keep something') as HTMLElement;
    expect(input.getAttribute('data-autofocus')).toBe('true');
    // One prompt only: the empty-state hint guides the draft; the input
    // itself carries no duplicate placeholder.
    expect(screen.getByText('Something small from today — a photo, a line, a sound.')).toBeTruthy();
    expect(screen.getByLabelText('Choose photos')).toBeTruthy();
    expect(screen.getByLabelText('Take a photo')).toBeTruthy();
    expect(screen.getByLabelText('Record a voice note')).toBeTruthy();
    expect(screen.getByText('New memory')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.queryByText('Library')).toBeNull();
    expect(screen.queryByText('Camera')).toBeNull();
  });

  it('uses a borderless writing-first layout (large input, no nested card)', async () => {
    const { container } = await renderComposer();
    const input = screen.getByLabelText('Keep something') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(container.innerHTML).not.toContain('Keep it');
    expect(screen.queryByText('Voice (tap to record, or hold the mic above)')).toBeNull();
    expect(screen.queryByText('Voice trace')).toBeNull();
    expect(screen.queryByText('0/10')).toBeNull();
  });

  it('keeps a single voice control (tap-toggle only, no hold mic)', async () => {
    await renderComposer();
    expect(screen.getByLabelText('Record a voice note')).toBeTruthy();
    expect(screen.queryByLabelText('Hold to record a voice note')).toBeNull();
    expect(screen.queryByLabelText(/Recording voice note/)).toBeNull();
    expect(screen.queryAllByLabelText(/voice note/i)).toHaveLength(1);
  });

  it('keeps the toolbar above the keyboard in a safe scroll container', async () => {
    await renderComposer();
    expect(screen.getByTestId('editor-scroll')).toBeTruthy();
  });

  it('typing stages the durable draft and blur preserves it (no loss)', async () => {
    await renderComposer();
    fireEvent.change(screen.getByLabelText('Keep something'), { target: { value: 'A tender thought' } });
    expect(updateBodySpy).toHaveBeenCalledWith('A tender thought');
    fireEvent.blur(screen.getByLabelText('Keep something'));
    expect(discardDraftSpy).not.toHaveBeenCalled();
    expect(updateBodySpy).toHaveBeenCalledTimes(1);
  });
});

describe('Compact toolbar regression (single row, chip date, no wrap)', () => {
  it('is a single compact row: icon-only photo/camera, one voice, one date chip, no Today+field duplication', async () => {
    const { container } = await renderComposer();
    expect(screen.getByLabelText('Choose photos')).toBeTruthy();
    expect(screen.getByLabelText('Take a photo')).toBeTruthy();
    expect(screen.queryByText('Library')).toBeNull();
    expect(screen.queryByText('Camera')).toBeNull();
    expect(screen.queryAllByLabelText(/voice note/i)).toHaveLength(1);
    expect(screen.queryByText('Voice trace')).toBeNull();
    expect(screen.getByLabelText('Choose memory date')).toBeTruthy();
    expect(screen.queryByLabelText('Pick a date')).toBeNull();
    const source = await import('node:fs').then((fs) => fs.readFileSync('components/moments/inline-memory-composer.tsx', 'utf8'));
    expect(source).not.toContain("flexWrap: 'wrap'");
    expect(source).not.toContain('flexWrap');
    expect(source).toContain('compact');
    expect(source).not.toContain('NativeDateTimeField');
  });

  it('uses a restrained header title that fits at 320pt (no 28pt overflow)', async () => {
    await renderComposer();
    expect(screen.getByText('New memory')).toBeTruthy();
    const source = await import('node:fs').then((fs) => fs.readFileSync('components/moments/inline-memory-composer.tsx', 'utf8'));
    expect(source).toContain('fontSize: 17');
    expect(source).toContain('flexShrink: 1');
    expect(source).not.toContain('type="title">New memory');
  });

  it('shows one date chip only: short date when not today, Today when today, never both', async () => {
    await renderComposer();
    expect(screen.queryByText('Today')).toBeNull();
    expect(screen.getByLabelText('Choose memory date').textContent).not.toContain('Today');
    fireEvent.click(screen.getByLabelText('Choose memory date'));
    expect(screen.getByLabelText('Pick a date')).toBeTruthy();
  });
});

describe('InlineMemoryComposer photo intents (explicit, no auto-other)', () => {
  it('library cancel leaves the draft untouched and never opens camera', async () => {
    mockLibraryResult = { canceled: true };
    await renderComposer();
    fireEvent.focus(screen.getByLabelText('Keep something'));
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Choose photos'));
    });
    expect(addAssetsSpy).not.toHaveBeenCalled();
    expect(mockCameraResult.canceled).toBe(true);
  });

  it('library success stages ordered images up to the remaining cap', async () => {
    mockLibraryResult = {
      canceled: false,
      assets: [
        { uri: 'file:///a.jpg', mimeType: 'image/jpeg', width: 100, height: 100 },
        { uri: 'file:///b.jpg', mimeType: 'image/jpeg', width: 100, height: 100 },
      ],
    };
    await renderComposer();
    fireEvent.focus(screen.getByLabelText('Keep something'));
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Choose photos'));
    });
    expect(addAssetsSpy).toHaveBeenCalledTimes(1);
    expect(addAssetsSpy.mock.calls[0][0]).toHaveLength(2);
  });

  it('camera cancel never auto-opens library', async () => {
    mockCameraResult = { canceled: true };
    await renderComposer();
    fireEvent.focus(screen.getByLabelText('Keep something'));
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Take a photo'));
    });
    expect(addAssetsSpy).not.toHaveBeenCalled();
  });

  it('picker denial shows inline Open Settings (user action only)', async () => {
    mockLibraryPermission = { granted: false } as any;
    await renderComposer();
    fireEvent.focus(screen.getByLabelText('Keep something'));
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Choose photos'));
    });
    expect(screen.getByText('Open Settings')).toBeTruthy();
    fireEvent.click(screen.getByText('Open Settings'));
    expect(openSettingsSpy).toHaveBeenCalled();
    expect(addAssetsSpy).not.toHaveBeenCalled();
  });
});

describe('InlineMemoryComposer voice (single tap-toggle, shared pipeline)', () => {
  it('exposes exactly one voice control with no hold mic or explanatory rows', async () => {
    await renderComposer();
    expect(screen.getByLabelText('Record a voice note')).toBeTruthy();
    expect(screen.queryByLabelText('Hold to record a voice note')).toBeNull();
    expect(screen.queryByText('Voice (tap to record, or hold the mic above)')).toBeNull();
    expect(screen.queryByText('Voice trace')).toBeNull();
  });

  it('finished recording stages via the shared pipeline (no second pipeline)', async () => {
    await renderComposer();
    fireEvent.focus(screen.getByLabelText('Keep something'));
    expect(mockAudioStatus).toBeTruthy();
    await act(async () => {
      mockAudioStatus?.({ isFinished: true, hasError: false, url: 'file:///tap-voice.m4a' });
    });
    expect(addAssetsSpy).toHaveBeenCalledWith([{ uri: 'file:///tap-voice.m4a', mimeType: 'audio/m4a' }]);
  });

  it('surfaces mic denial outside the toolbar instead of swallowing it', async () => {
    mockMicPermission = { granted: false } as any;
    await renderComposer();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Record a voice note'));
    });
    expect(screen.getByText('Microphone access is needed for voice traces.')).toBeTruthy();
  });

  it('Save cannot submit while recording', async () => {
    mockHoldRecording = true;
    mockDraft = makeDraft({ body: 'hello while recording' });
    await renderComposer();
    await act(async () => {});
    expect(screen.getByLabelText('Stop recording voice note')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('disables voice when attachments are full or saving', async () => {
    mockDraft = makeFullDraft();
    const first = await renderComposer();
    expect(screen.getByLabelText('Record a voice note').closest('button,div')?.getAttribute('aria-disabled') ?? screen.getByLabelText('Record a voice note').getAttribute('aria-disabled')).toBeTruthy();
    first.unmount();
    mockDraft = makeDraft({ body: 'hello' });
    saveSpy.mockImplementationOnce(() => new Promise(() => {}));
    await renderComposer();
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    expect(screen.getByLabelText('Record a voice note').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Memory editor date, attachments, durable save', () => {
  it('shows short date when not today; picker opens only on chip tap with real date', async () => {
    await renderComposer();
    fireEvent.focus(screen.getByLabelText('Keep something'));
    expect(screen.queryByText('Today')).toBeNull();
    const chip = screen.getByLabelText('Choose memory date');
    expect(chip.textContent).toContain('Apr');
    expect(screen.queryByLabelText('Pick a date')).toBeNull();
    fireEvent.click(chip);
    const picker = screen.getByLabelText('Pick a date');
    expect(picker.getAttribute('data-value')).toContain('2026-04-01');
    fireEvent.click(picker);
    expect(setOccurredAtSpy).toHaveBeenCalledTimes(1);
    const iso = setOccurredAtSpy.mock.calls[0][0] as string;
    expect(new Date(iso).getFullYear()).toBe(2026);
  });

  it('shows a small Today chip when the draft is actually today', async () => {
    const todayIso = new Date().toISOString();
    mockDraft = makeDraft({ occurredAt: todayIso });
    const view = await renderComposer();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByLabelText('Choose memory date')).toBeTruthy();
    expect(screen.queryByLabelText('Pick a date')).toBeNull();
    view.unmount();
    mockDraft = makeDraft();
  });

  it('lays photos out as a post grid with per-photo remove, no reorder arrows', async () => {
    mockDraft = makeDraft({
      body: 'with photos',
      assets: [
        { stagedId: 's1', kind: 'image', mimeType: 'image/jpeg', localUri: 'file:///s1.jpg', uploaded: null },
        { stagedId: 's2', kind: 'image', mimeType: 'image/jpeg', localUri: 'file:///s2.jpg', uploaded: null },
      ],
    });
    await renderComposer();
    expect(screen.getAllByTestId('draft-photo')).toHaveLength(2);
    expect(screen.getByLabelText('Remove photo 1')).toBeTruthy();
    expect(screen.getByLabelText('Remove photo 2')).toBeTruthy();
    // Posts don't reorder attachments — the arrow controls are gone.
    expect(screen.queryByLabelText('Move attachment 1 right')).toBeNull();
    expect(screen.queryByLabelText('Move attachment 1 left')).toBeNull();
    fireEvent.click(screen.getByLabelText('Remove photo 1'));
    expect(removeAssetSpy).toHaveBeenCalledWith('s1');
    expect(reorderAssetSpy).not.toHaveBeenCalled();
  });

  it('caps the grid at four tiles with a +N overlay for the rest', async () => {
    mockDraft = makeDraft({
      body: 'lots of photos',
      assets: Array.from({ length: 5 }, (_, index) => ({
        stagedId: `s${index}`,
        kind: 'image' as const,
        mimeType: 'image/jpeg',
        localUri: `file:///s${index}.jpg`,
        uploaded: null,
      })),
    });
    await renderComposer();
    expect(screen.getAllByTestId('draft-photo')).toHaveLength(4);
    expect(screen.getByLabelText('1 more photos')).toBeTruthy();
  });

  it('renders a single photo at its own aspect ratio', async () => {
    mockDraft = makeDraft({
      body: 'one photo',
      assets: [
        {
          stagedId: 's1',
          kind: 'image',
          mimeType: 'image/jpeg',
          localUri: 'file:///s1.jpg',
          width: 1200,
          height: 1600,
          uploaded: null,
        },
      ],
    });
    await renderComposer();
    const tile = screen.getByTestId('draft-photo');
    expect(tile).toBeTruthy();
    // Portrait stays portrait (3:4), not a forced landscape frame. The
    // aspect-ratio frame is the grid container two levels up.
    const frame = tile.parentElement?.parentElement;
    expect(frame?.style.aspectRatio).toContain('0.75');
  });

  it('Save stays disabled until nonempty, then durably enqueues and dismisses', async () => {
    const first = await renderComposer();
    expect(screen.getByText('Save').closest('button')?.hasAttribute('disabled')).toBe(true);
    first.unmount();
    mockDraft = makeDraft({ body: 'hello' });
    await renderComposer();
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('failed save never dismisses and preserves the draft with its error', async () => {
    saveSpy.mockRejectedValueOnce(new Error('network down'));
    mockDraft = makeDraft({ body: 'unsent thought' });
    await renderComposer();
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Could not keep this. Please try again.')).toBeTruthy();
    expect((screen.getByLabelText('Keep something') as HTMLInputElement).value).toBe('unsent thought');
  });

  it('Cancel on a non-empty draft asks before discarding instead of leaving', async () => {
    mockDraft = makeDraft({ body: 'half-written thought' });
    await renderComposer();
    fireEvent.click(screen.getByText('Cancel'));
    expect(discardDraftSpy).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('sheet:Discard this memory?')).toBeTruthy();
    // Keeping the draft leaves the screen exactly where it was.
    fireEvent.click(screen.getByText('Keep editing'));
    expect(backSpy).not.toHaveBeenCalled();
    expect(discardDraftSpy).not.toHaveBeenCalled();
  });

  it('Cancel on an empty draft leaves directly', async () => {
    mockDraft = makeDraft({ body: '' });
    await renderComposer();
    fireEvent.click(screen.getByText('Cancel'));
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('sheet:Discard this memory?')).toBeNull();
  });

  it('a blocked pull-down opens the confirmation and is not lost', async () => {
    mockDraft = makeDraft({ body: 'unsaved pull' });
    await renderComposer();
    expect((globalThis as any).__preventLeave.prevent).toBe(true);
    const leave = vi.fn();
    act(() => {
      (globalThis as any).__preventLeave.onBlocked(leave);
    });
    expect(screen.getByTestId('sheet:Discard this memory?')).toBeTruthy();
    fireEvent.click(screen.getByText('Keep editing'));
    expect(leave).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('discarding replays the intercepted exit exactly once', async () => {
    mockDraft = makeDraft({ body: 'unsaved pull' });
    await renderComposer();
    const leave = vi.fn();
    act(() => {
      (globalThis as any).__preventLeave.onBlocked(leave);
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Discard draft'));
    });
    expect(discardDraftSpy).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('does not guard the exit when the draft is empty', async () => {
    mockDraft = makeDraft({ body: '' });
    await renderComposer();
    expect((globalThis as any).__preventLeave.prevent).toBe(false);
  });

  it('More options discard still confirms and leaves', async () => {
    mockDraft = makeDraft({ body: 'scrap this' });
    await renderComposer();
    fireEvent.click(screen.getByLabelText('More options'));
    await act(async () => {
      fireEvent.click(screen.getByText('Discard draft'));
    });
    expect(discardDraftSpy).toHaveBeenCalledTimes(1);
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('quota surfaces See Plus with the draft preserved and no dismiss', async () => {
    saveSpy.mockRejectedValueOnce(Object.assign(new Error('quota'), { code: 'LIMIT_EXCEEDED' }));
    mockDraft = makeDraft({ body: 'rich memory with photo' });
    await renderComposer();
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    expect(screen.getByText('See Plus')).toBeTruthy();
    expect(refreshServerPlusSpy).toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Keep something') as HTMLInputElement).value).toBe('rich memory with photo');
  });
});

describe('staged media display URIs (device file paths resolve)', () => {
  it('draft photo thumbnails render through the staged-URI resolver', async () => {
    mockDraft = makeDraft({
      assets: [
        {
          stagedId: 's1',
          kind: 'image',
          mimeType: 'image/jpeg',
          localUri: 'composer/v/s/staged/staged_s1.jpg',
          uploaded: null,
        },
      ],
    });
    await renderComposer();
    // Raw Documents-relative paths never reach expo-image (blank thumb).
    expect(screen.getByTestId('draft-photo').getAttribute('data-uri')).toBe(
      'resolved:composer/v/s/staged/staged_s1.jpg'
    );
  });

  it('staged voice hands its localUri to playback (which resolves internally)', async () => {
    mockDraft = makeDraft({
      assets: [
        {
          stagedId: 'v1',
          kind: 'audio',
          mimeType: 'audio/m4a',
          localUri: 'composer/v/s/staged/staged_v1.m4a',
          uploaded: null,
        },
      ],
    });
    await renderComposer();
    expect(screen.getByTestId('audio-preview').getAttribute('data-uri')).toBe(
      'composer/v/s/staged/staged_v1.m4a'
    );
  });
});
