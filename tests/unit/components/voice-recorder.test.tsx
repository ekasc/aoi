import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VoiceRecorder } from '@/components/media/voice-recorder';

const audio = vi.hoisted(() => ({
  permission: vi.fn(),
  mode: vi.fn(),
  recorder: { prepareToRecordAsync: vi.fn(), record: vi.fn(), stop: vi.fn(), isRecording: false },
  state: { isRecording: false, durationMillis: 0 },
  listener: (_status: { isFinished: boolean; hasError: boolean; url?: string }) => {},
  press: () => {},
}));

vi.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: audio.permission,
  setAudioModeAsync: audio.mode,
  useAudioRecorder: (_options: unknown, listener: typeof audio.listener) => {
    audio.listener = listener;
    return audio.recorder;
  },
  useAudioRecorderState: () => audio.state,
}));
vi.mock('@/features/haptics/haptics', () => ({ haptics: { tap: vi.fn(), impact: vi.fn() } }));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#123456' }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({ children, onPress, disabled, accessibilityLabel, accessibilityState }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel: string;
    accessibilityState: { busy: boolean; disabled: boolean };
  }) => {
    audio.press = onPress;
    return <button onClick={onPress} disabled={disabled} aria-label={accessibilityLabel}
      aria-busy={accessibilityState.busy} aria-disabled={accessibilityState.disabled}>{children}</button>;
  },
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function press() {
  await act(async () => { fireEvent.click(screen.getByRole('button')); });
}

beforeEach(() => {
  vi.resetAllMocks();
  audio.permission.mockResolvedValue({ granted: true });
  audio.mode.mockResolvedValue(undefined);
  audio.recorder.prepareToRecordAsync.mockResolvedValue(undefined);
  audio.recorder.stop.mockResolvedValue(undefined);
  audio.state = { isRecording: false, durationMillis: 0 };
  audio.recorder.isRecording = false;
});

describe('VoiceRecorder operation ownership', () => {
  it.each([false, true])('serializes same-render starts and exposes busy state, compact=%s', async (compact) => {
    const pending = deferred();
    audio.recorder.prepareToRecordAsync.mockReturnValueOnce(pending.promise);
    render(<VoiceRecorder compact={compact} onRecorded={vi.fn()} />);
    act(() => { const tap = audio.press; tap(); tap(); });
    await act(async () => {});
    expect(audio.permission).toHaveBeenCalledTimes(1);
    expect(audio.mode).toHaveBeenCalledTimes(1);
    expect(audio.recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button').getAttribute('aria-disabled')).toBe('true');
    await act(async () => { pending.resolve(); });
    expect(audio.recorder.record).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('false');
    act(() => { const tap = audio.press; tap(); tap(); });
    await act(async () => {});
    expect(audio.recorder.stop).toHaveBeenCalledTimes(1);
  });

  it.each(['permission', 'mode', 'prepare', 'record'] as const)('allows retry after %s rejection', async (stage) => {
    const onError = vi.fn();
    const operation = stage === 'permission' ? audio.permission : stage === 'mode' ? audio.mode
      : stage === 'prepare' ? audio.recorder.prepareToRecordAsync : audio.recorder.record;
    if (stage === 'record') operation.mockImplementationOnce(() => { throw new Error('failed'); });
    else operation.mockRejectedValueOnce(new Error('failed'));
    render(<VoiceRecorder onRecorded={vi.fn()} onError={onError} />);
    await press();
    expect(onError).toHaveBeenCalledTimes(1);
    await press();
    expect(audio.recorder.record).toHaveBeenCalledTimes(stage === 'record' ? 2 : 1);
  });

  it('clears denied permission on successful retry', async () => {
    audio.permission.mockResolvedValueOnce({ granted: false });
    const onRecorded = vi.fn();
    render(<VoiceRecorder onRecorded={onRecorded} />);
    await press();
    await press();
    expect(audio.recorder.record).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Microphone access is needed for voice traces.')).toBeNull();
    act(() => {
      audio.listener({ isFinished: true, hasError: false, url: 'file://note' });
      audio.listener({ isFinished: true, hasError: false, url: 'file://note' });
    });
    expect(onRecorded).toHaveBeenCalledExactlyOnceWith('file://note');
  });

  it('handles an asynchronously rejected permission request without a late error after unmount', async () => {
    const pending = deferred();
    audio.permission.mockReturnValueOnce(pending.promise);
    const onError = vi.fn();
    const view = render(<VoiceRecorder onRecorded={vi.fn()} onError={onError} />);
    await press();
    view.unmount();
    await act(async () => { pending.reject(new Error('permission unavailable')); });
    expect(onError).not.toHaveBeenCalled();
    expect(audio.mode).not.toHaveBeenCalled();
  });

  it('does not revive a cancelled preparation when re-enabled before it settles', async () => {
    const pending = deferred();
    audio.recorder.prepareToRecordAsync.mockReturnValueOnce(pending.promise);
    const props = { onRecorded: vi.fn(), onError: vi.fn() };
    const view = render(<VoiceRecorder {...props} />);
    await press();
    view.rerender(<VoiceRecorder {...props} disabled />);
    view.rerender(<VoiceRecorder {...props} />);
    await act(async () => { pending.resolve(); });
    expect(audio.recorder.record).not.toHaveBeenCalled();
    await press();
    expect(audio.recorder.record).toHaveBeenCalledTimes(1);
  });

  it.each(['permission', 'mode', 'prepare'] as const)('cancels %s completion on disable or unmount', async (stage) => {
    for (const action of ['disable', 'unmount']) {
      const pending = deferred();
      const operation = stage === 'permission' ? audio.permission : stage === 'mode' ? audio.mode : audio.recorder.prepareToRecordAsync;
      operation.mockReturnValueOnce(stage === 'permission' ? pending.promise.then(() => ({ granted: true })) : pending.promise);
      const onRecorded = vi.fn();
      const onError = vi.fn();
      const onRecordingChange = vi.fn();
      const props = { onRecorded, onError, onRecordingChange };
      const view = render(<VoiceRecorder {...props} />);
      await press();
      if (action === 'disable') view.rerender(<VoiceRecorder {...props} disabled />);
      else view.unmount();
      onRecordingChange.mockClear();
      await act(async () => { pending.resolve(); });
      act(() => {
        audio.listener({ isFinished: true, hasError: false, url: 'file://late' });
        audio.listener({ isFinished: true, hasError: true });
      });
      expect(audio.recorder.record).not.toHaveBeenCalled();
      expect(onRecorded).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(onRecordingChange).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('serializes a manual stop racing the 30-second cap and permits retry after stop failure', async () => {
    const pending = deferred();
    const onError = vi.fn();
    const props = { onRecorded: vi.fn(), onError };
    const view = render(<VoiceRecorder {...props} />);
    await press();
    audio.recorder.stop.mockReturnValueOnce(pending.promise);
    act(() => {
      audio.press();
      audio.state = { isRecording: true, durationMillis: 30_000 };
      view.rerender(<VoiceRecorder {...props} />);
    });
    expect(audio.recorder.stop).toHaveBeenCalledTimes(1);
    await act(async () => { pending.reject(new Error('stop failed')); });
    expect(onError).toHaveBeenCalledTimes(1);
    audio.state = { isRecording: false, durationMillis: 0 };
    view.rerender(<VoiceRecorder {...props} />);
    await press();
    expect(audio.recorder.record).toHaveBeenCalledTimes(2);
  });

  it('auto-stops at 30 seconds once and suppresses callbacks after disable', async () => {
    const props = { onRecorded: vi.fn(), onError: vi.fn() };
    const view = render(<VoiceRecorder {...props} />);
    await press();
    audio.state = { isRecording: true, durationMillis: 30_000 };
    await act(async () => { view.rerender(<VoiceRecorder {...props} />); });
    expect(audio.recorder.stop).toHaveBeenCalledTimes(1);
    view.rerender(<VoiceRecorder {...props} disabled />);
    act(() => { audio.listener({ isFinished: true, hasError: false, url: 'file://late' }); });
    expect(props.onRecorded).not.toHaveBeenCalled();
  });

  it('retries stopping rather than starting a second recording when a failed stop leaves native capture running', async () => {
    const onRecorded = vi.fn();
    render(<VoiceRecorder onRecorded={onRecorded} onError={vi.fn()} />);
    await press();
    audio.recorder.isRecording = true;
    audio.recorder.stop.mockRejectedValueOnce(new Error('stop failed'));
    await press();
    audio.recorder.stop.mockImplementationOnce(async () => {
      audio.recorder.isRecording = false;
      audio.listener({ isFinished: true, hasError: false, url: 'file://retried' });
    });
    await press();
    expect(audio.recorder.record).toHaveBeenCalledTimes(1);
    expect(audio.recorder.stop).toHaveBeenCalledTimes(2);
    expect(onRecorded).toHaveBeenCalledExactlyOnceWith('file://retried');
  });

  it('suppresses a pending stop failure after disable and re-enable', async () => {
    const pending = deferred();
    const props = { onRecorded: vi.fn(), onError: vi.fn() };
    const view = render(<VoiceRecorder {...props} />);
    await press();
    audio.recorder.stop.mockReturnValueOnce(pending.promise);
    await press();
    view.rerender(<VoiceRecorder {...props} disabled />);
    view.rerender(<VoiceRecorder {...props} />);
    await act(async () => { pending.reject(new Error('late stop failure')); });
    expect(props.onError).not.toHaveBeenCalled();
    expect(audio.recorder.stop).toHaveBeenCalledTimes(1);
  });

  it('restores the audio session after a finished recording so later playback is not routed for capture', async () => {
    const props = { onRecorded: vi.fn(), onError: vi.fn() };
    render(<VoiceRecorder {...props} />);
    await press();
    expect(audio.mode).toHaveBeenLastCalledWith({ allowsRecording: true, playsInSilentMode: true });

    act(() => { audio.listener({ isFinished: true, hasError: false, url: 'file://note' }); });
    expect(audio.mode).toHaveBeenLastCalledWith({ allowsRecording: false, playsInSilentMode: true });

    await press();
    expect(audio.mode).toHaveBeenLastCalledWith({ allowsRecording: true, playsInSilentMode: true });
    act(() => { audio.listener({ isFinished: true, hasError: true }); });
    expect(audio.mode).toHaveBeenLastCalledWith({ allowsRecording: false, playsInSilentMode: true });
  });

  it('restores the audio session when a start is cancelled after it locked the session', async () => {
    const pending = deferred();
    audio.recorder.prepareToRecordAsync.mockReturnValueOnce(pending.promise);
    const props = { onRecorded: vi.fn() };
    const view = render(<VoiceRecorder {...props} />);
    await press();
    expect(audio.mode).toHaveBeenLastCalledWith({ allowsRecording: true, playsInSilentMode: true });

    view.rerender(<VoiceRecorder {...props} disabled />);
    await act(async () => { pending.resolve(); });
    expect(audio.recorder.record).not.toHaveBeenCalled();
    expect(audio.mode).toHaveBeenLastCalledWith({ allowsRecording: false, playsInSilentMode: true });
  });

  it('restores the audio session when the recorder unmounts mid-recording', async () => {
    const view = render(<VoiceRecorder onRecorded={vi.fn()} />);
    await press();
    view.unmount();
    expect(audio.mode).toHaveBeenLastCalledWith({ allowsRecording: false, playsInSilentMode: true });
  });

  it('keeps the capture session while a failed stop leaves native recording running', async () => {
    render(<VoiceRecorder onRecorded={vi.fn()} onError={vi.fn()} />);
    await press();
    audio.recorder.isRecording = true;
    audio.recorder.stop.mockRejectedValueOnce(new Error('stop failed'));
    await press();
    expect(audio.recorder.stop).toHaveBeenCalledTimes(1);
    expect(audio.mode).toHaveBeenCalledTimes(1);
  });
});
