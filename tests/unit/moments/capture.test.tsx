import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

// Resolve press-state styles as unpressed so the real capture screens render
// (Button/IconButton compute `style={({ pressed }) => ...}`).
vi.mock('react-native', () => {
  function flattenStyle(style: unknown): unknown {
    if (Array.isArray(style)) {
      const merged: Record<string, unknown> = {};
      for (const entry of style) {
        const flat = flattenStyle(entry);
        if (flat && typeof flat === 'object') Object.assign(merged, flat);
      }
      return merged;
    }
    return style;
  }

  function withAriaProps(props: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = { ...props };
    if (typeof props.accessibilityLabel === 'string') {
      next['aria-label'] = props.accessibilityLabel;
    }
    if (typeof props.onPress === 'function') {
      next.onClick = props.onPress;
    }
    return next;
  }

  function createDiv(children: unknown, style: unknown, props: Record<string, unknown>) {
    return createElement(
      'div',
      { style: flattenStyle(style), ...withAriaProps(props) },
      children
    );
  }

  const View = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createDiv(children, style, rest);
  };

  const Text = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createElement(
      'span',
      { style: flattenStyle(style), ...withAriaProps(rest) },
      children
    );
  };

  const Pressable = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    return createDiv(children, resolved, rest);
  };

  const TextInput = (props: Record<string, any>) => {
    const { style, value, onChangeText, placeholder, autoFocus, ...rest } = props;
    return createElement('input', {
      style: flattenStyle(style),
      value: value ?? '',
      placeholder,
      autoFocus: autoFocus ? true : undefined,
      'data-autofocus': autoFocus ? 'true' : 'false',
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
      ...withAriaProps(rest),
    });
  };

  return {
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      hairlineWidth: 1,
      flatten: flattenStyle,
    },
    View,
    Text,
    TextInput,
    Pressable,
    ScrollView: View,
    KeyboardAvoidingView: View,
    Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
  };
});

vi.mock('react-native-reanimated', () => {
  const chain: Record<string, () => unknown> = {};
  chain.duration = () => chain;
  chain.delay = () => chain;
  chain.reduceMotion = () => chain;
  return {
    default: {
      createAnimatedComponent: (component: unknown) => component,
      View: ({ children }: { children?: unknown }) =>
        createElement('div', {}, children),
    },
    FadeIn: chain,
    FadeOut: chain,
    FadeInDown: chain,
    ReduceMotion: { System: 'system' },
    useReducedMotion: () => false,
  };
});

const pushSpy = vi.fn();
const backSpy = vi.fn();
const dismissToSpy = vi.fn();
const replaceSpy = vi.fn();
let searchParams: Record<string, string> = {};

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: pushSpy, back: backSpy, replace: replaceSpy, dismissTo: dismissToSpy }),
  useLocalSearchParams: () => searchParams,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({ addMoment }),
}));

vi.mock('@/features/subscription/subscription-context', () => ({
  useSubscription: () => ({ refreshServerPlus }),
}));

const refreshServerPlus = vi.fn(async () => {});

vi.mock('@/features/media/use-media-upload', () => ({
  useMediaUpload: () => ({
    uploadImage,
    state: 'idle',
    progress: 0,
    error: null,
    reset: vi.fn(),
  }),
  isQuotaExceededError: (error: unknown) =>
    (error as { code?: unknown } | null)?.code === 'LIMIT_EXCEEDED',
}));

vi.mock('@/components/media/media-picker', () => ({
  MediaPicker: ({ onMediaSelected }: { onMediaSelected: (selection: { uri: string; mimeType: string }) => void }) =>
    createElement('button', {
      onClick: () => onMediaSelected({ uri: 'file:///photo.jpg', mimeType: 'image/jpeg' }),
    }, 'Pick media'),
}));

vi.mock('@/components/media/voice-recorder', () => ({
  VoiceRecorder: ({ onRecorded }: { onRecorded: (uri: string) => void }) =>
    createElement('button', {
      onClick: () => onRecorded('file:///voice.m4a'),
    }, 'Record voice'),
}));

// Exercise the remote upload path (the shared setup stubs stub-mode on).
vi.mock('@/features/api-client', () => ({
  isStubMode: () => false,
}));

vi.mock('@/components/forms/native-date-time-field', () => ({
  NativeDateTimeField: () => null,
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: { children?: unknown }) =>
    createElement('div', {}, children),
}));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => launchImageLibraryAsyncMock(...args),
  launchCameraAsync: (...args: unknown[]) => launchCameraAsyncMock(...args),
}));

const addMoment = vi.fn();
const uploadImage = vi.fn();
const launchImageLibraryAsyncMock = vi.fn();
const launchCameraAsyncMock = vi.fn();

function fillNoteForm(title: string, body: string) {
  fireEvent.change(screen.getByPlaceholderText('What was it?'), {
    target: { value: title },
  });
  fireEvent.change(screen.getByPlaceholderText("The details you'll want later"), {
    target: { value: body },
  });
}

beforeEach(() => {
  pushSpy.mockClear();
  backSpy.mockClear();
  dismissToSpy.mockClear();
  replaceSpy.mockClear();
  addMoment.mockReset();
  uploadImage.mockReset();
  launchImageLibraryAsyncMock.mockReset();
  launchCameraAsyncMock.mockReset();
  refreshServerPlus.mockClear();
  searchParams = {};
  addMoment.mockResolvedValue({ id: 'saved-1' });
  uploadImage.mockResolvedValue({ mediaId: 'media-1', url: 'https://cdn.test/media-1' });
  launchImageLibraryAsyncMock.mockResolvedValue({ canceled: true, assets: [] });
  launchCameraAsyncMock.mockResolvedValue({ canceled: true, assets: [] });
});

function quotaError() {
  return Object.assign(new Error('This space is out of media room'), { code: 'LIMIT_EXCEEDED' });
}

describe('Story capture identity (opaque per-draft ids)', () => {
  it('offers no goal creation — future goals are Plans-owned', async () => {
    const { MomentForm } = await import('@/components/moments/moment-form');
    render(
      <MomentForm
        heroSubtitle="Sub"
        onCancel={() => {}}
        onSubmit={vi.fn(async () => {})}
        submitLabel="Save"
        submittingLabel="Saving…"
      />
    );
    expect(screen.getByText('Note')).toBeTruthy();
    expect(screen.getByText('Media')).toBeTruthy();
    expect(screen.queryByText('Goal')).toBeNull();
  });

  it('two separate identical note drafts receive different client IDs', async () => {
    const { MomentForm } = await import('@/components/moments/moment-form');
    const firstSubmit = vi.fn(async () => {});
    const { unmount: unmountFirst } = render(
      <MomentForm
        heroSubtitle="Sub"
        onCancel={() => {}}
        onSubmit={firstSubmit}
        submitLabel="Save"
        submittingLabel="Saving…"
      />
    );
    fillNoteForm('Same words', 'Same body');
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    expect(firstSubmit).toHaveBeenCalledTimes(1);
    unmountFirst();

    const secondSubmit = vi.fn(async () => {});
    render(
      <MomentForm
        heroSubtitle="Sub"
        onCancel={() => {}}
        onSubmit={secondSubmit}
        submitLabel="Save"
        submittingLabel="Saving…"
      />
    );
    fillNoteForm('Same words', 'Same body');
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    expect(secondSubmit).toHaveBeenCalledTimes(1);

    const firstId = firstSubmit.mock.calls[0][0].clientId as string;
    const secondId = secondSubmit.mock.calls[0][0].clientId as string;
    expect(firstId).toMatch(/^moment_/);
    expect(secondId).not.toBe(firstId);
  });

  it('retrying one failed draft reuses its client ID', async () => {
    const { MomentForm } = await import('@/components/moments/moment-form');
    const onSubmit = vi.fn(async () => {});
    onSubmit.mockRejectedValueOnce(new Error('network down'));
    render(
      <MomentForm
        heroSubtitle="Sub"
        onCancel={() => {}}
        onSubmit={onSubmit}
        submitLabel="Save"
        submittingLabel="Saving…"
      />
    );
    fillNoteForm('Keep trying', 'Body here');
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[0][0].clientId).toBe(onSubmit.mock.calls[1][0].clientId);
  });

  it('editing a draft preserves its client ID', async () => {
    const { MomentForm } = await import('@/components/moments/moment-form');
    const onSubmit = vi.fn(async () => {});
    render(
      <MomentForm
        heroSubtitle="Sub"
        onCancel={() => {}}
        onSubmit={onSubmit}
        submitLabel="Save"
        submittingLabel="Saving…"
      />
    );
    fillNoteForm('Draft', 'First version');
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("The details you'll want later"), {
        target: { value: 'Edited version' },
      });
    });
    onSubmit.mockRejectedValueOnce(new Error('network down'));
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[0][0].clientId).toBe(onSubmit.mock.calls[1][0].clientId);
    expect(onSubmit.mock.calls[1][0].body).toBe('Edited version');
  });

  it('rapid double submit of one draft publishes once', async () => {
    const { MomentForm } = await import('@/components/moments/moment-form');
    const onSubmit = vi.fn(async () => {});
    render(
      <MomentForm
        heroSubtitle="Sub"
        onCancel={() => {}}
        onSubmit={onSubmit}
        submitLabel="Save"
        submittingLabel="Saving…"
      />
    );
    fillNoteForm('Double tap', 'Body');
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    await act(async () => {});

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('photo publishes with the returned mediaId and stable media URL', async () => {    const { MomentForm } = await import('@/components/moments/moment-form');
    const onSubmit = vi.fn(async () => {});
    render(
      <MomentForm
        heroSubtitle="Sub"
        onCancel={() => {}}
        onSubmit={onSubmit}
        submitLabel="Save"
        submittingLabel="Saving…"
      />
    );
    fireEvent.click(screen.getByText('Media'));
    fireEvent.click(screen.getByText('Pick media'));
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(uploadImage).toHaveBeenCalledWith({ uri: 'file:///photo.jpg', mimeType: 'image/jpeg' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const values = onSubmit.mock.calls[0][0];
    expect(values.mediaId).toBe('media-1');
    expect(values.mediaPreview).toBe('https://cdn.test/media-1');
    expect(values.clientId).toMatch(/^moment_/);
  });
});
