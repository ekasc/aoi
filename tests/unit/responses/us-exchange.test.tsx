import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsExchange } from '@/components/home/us-exchange';
import type { Moment } from '@/features/moments/types';
import type { MomentResponse } from '@/features/responses/types';

const state = vi.hoisted(() => ({
  add: vi.fn(), loadFor: vi.fn(), responses: [] as MomentResponse[], error: null as string | null,
}));
vi.mock('@/features/responses/responses-context', () => ({ useResponses: () => ({ ...state, isLoading: false }) }));
vi.mock('@/features/session/session-context', () => ({ useSession: () => ({ user: { id: 'you', displayName: 'You' } }) }));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: (_: unknown, token: string) => token === 'textPrimary' ? '#111111' : '#555555' }));
vi.mock('@/features/haptics/haptics', () => ({ haptics: { select: vi.fn() } }));
vi.mock('@/features/media/image-source', () => ({ imageSourceForUri: (uri: string) => ({ uri }) }));
vi.mock('@/components/ui/button', () => ({ Button: ({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) => <button disabled={disabled} onClick={onPress}>{label}</button> }));
vi.mock('@/components/ui/native-sheet', () => ({ NativeSheet: ({ visible, dismissible, children }: { visible: boolean; dismissible: boolean; children: ReactNode }) => visible ? <section data-testid="response-sheet" data-dismissible={String(dismissible)}>{children}</section> : null }));
vi.mock('@/components/media/media-picker', () => ({ MediaPicker: ({ onMediaSelected, selectedUri, disabled }: { onMediaSelected: (selection: { uri: string; mimeType: string }) => void; selectedUri?: string; disabled?: boolean }) => <button disabled={disabled} onClick={() => onMediaSelected({ uri: 'file:///photo.png', mimeType: 'image/png' })}>{selectedUri ?? 'Pick test photo'}</button> }));
vi.mock('@/components/media/voice-recorder', () => ({ VoiceRecorder: ({ onRecorded, onRecordingChange }: { onRecorded: (uri: string) => void; onRecordingChange: (recording: boolean) => void }) => <><button onClick={() => onRecorded('file:///voice.m4a')}>Record test voice</button><button onClick={() => onRecordingChange(true)}>Start recording</button></> }));
vi.mock('@/components/media/audio-player', () => ({ AudioPlayer: ({ uri }: { uri: string }) => <span>Listen: {uri}</span> }));
vi.mock('@/components/moments/photo-viewer', () => ({ PhotoViewer: ({ visible, photos, onClose }: { visible: boolean; photos: { uri: string; label: string }[]; onClose: () => void }) => visible ? <section role="dialog" aria-label={photos[0].label}><span>{photos[0].uri}</span><button onClick={onClose}>Close photo</button></section> : null }));

const moment: Moment = { id: 'memory', type: 'note', title: 'A day', body: 'Words', occurredAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', authorId: 'you', authorRole: 'you', authorName: 'You' };
beforeEach(() => {
  state.add.mockReset().mockResolvedValue(true);
  state.loadFor.mockReset();
  state.responses = [];
  state.error = null;
});

describe('Memory response composition', () => {
  it('renders a photo response with its authorship instead of a text-only placeholder', () => {
    state.responses = [{ id: 'photo', momentId: 'memory', authorId: 'partner', authorName: 'June', authorRole: 'partner', kind: 'photo', body: null, mediaPreview: 'https://example.test/photo.jpg', audioUri: null, createdAt: moment.createdAt }];
    render(<UsExchange moment={moment} />);
    const photo = screen.getByAltText('');
    expect(screen.getByLabelText('Open photo from June fullscreen')).toBeTruthy();
    expect(photo.getAttribute('src')).toBe('https://example.test/photo.jpg');
    expect(screen.getByText('June')).toBeTruthy();
    fireEvent.error(photo);
    expect(screen.getByText('Could not load this photo.')).toBeTruthy();
    fireEvent.click(screen.getByText('Retry photo'));
    fireEvent.click(screen.getByLabelText('Open photo from June fullscreen'));
    expect(screen.getByRole('dialog', { name: 'Photo from June' }).textContent).toContain('https://example.test/photo.jpg');
    fireEvent.click(screen.getByText('Close photo'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps photo and voice drafts separate while allowing the reader to return to either', async () => {
    render(<UsExchange moment={moment} />);
    fireEvent.click(screen.getByLabelText('Photo'));
    fireEvent.click(screen.getByText('Pick test photo'));
    fireEvent.click(screen.getByText('Not now'));
    fireEvent.click(screen.getByLabelText('Voice note'));
    expect((screen.getByText('Add to this memory') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Record test voice'));
    expect(screen.getByText('Listen: file:///voice.m4a')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText('Add to this memory')));
    expect(state.add).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'voice', audioUri: 'file:///voice.m4a' }));
    fireEvent.click(screen.getByLabelText('Photo'));
    expect(screen.getByText('file:///photo.png')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText('Add to this memory')));
    expect(state.add).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'photo', mediaPreview: 'file:///photo.png', mimeType: 'image/png' }));
  });

  it('exposes the word limit and keeps words after a failed send', async () => {
    state.add.mockResolvedValue(false);
    render(<UsExchange moment={moment} />);
    fireEvent.click(screen.getByLabelText('Words'));
    const input = screen.getByLabelText('Your words about this memory') as HTMLInputElement;
    expect(input.maxLength).toBe(400);
    fireEvent.change(input, { target: { value: 'Remember the rain' } });
    expect(screen.getByText('17/400')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText('Add to this memory')));
    expect(input.value).toBe('Remember the rain');
    expect(screen.getByText('That did not go through. Nothing was lost, try again.')).toBeTruthy();
  });

  it('blocks duplicate sends and dismissal while a response is being saved', async () => {
    let finish: (value: boolean) => void = () => {};
    state.add.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    render(<UsExchange moment={moment} />);
    fireEvent.click(screen.getByLabelText('Words'));
    fireEvent.change(screen.getByLabelText('Your words about this memory'), { target: { value: 'Words' } });
    fireEvent.click(screen.getByText('Add to this memory'));
    expect(screen.getByTestId('response-sheet').getAttribute('data-dismissible')).toBe('false');
    expect((screen.getByText('Not now') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Sending…') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Sending…'));
    expect(state.add).toHaveBeenCalledTimes(1);
    await act(async () => finish(true));
    expect(screen.queryByTestId('response-sheet')).toBeNull();
  });

  it('does not submit an old voice clip while recording its replacement', () => {
    render(<UsExchange moment={moment} />);
    fireEvent.click(screen.getByLabelText('Voice note'));
    fireEvent.click(screen.getByText('Record test voice'));
    fireEvent.click(screen.getByText('Start recording'));
    expect((screen.getByText('Add to this memory') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('response-sheet').getAttribute('data-dismissible')).toBe('false');
  });

  it('shows a failed read even when previously loaded responses remain visible', () => {
    state.responses = [{ id: 'r', momentId: 'memory', authorId: 'you', authorName: 'You', authorRole: 'you', kind: 'word', body: 'Kept words', mediaPreview: null, audioUri: null, createdAt: moment.createdAt }];
    state.error = 'Could not load responses.';
    render(<UsExchange moment={moment} />);
    expect(screen.getByText('Kept words')).toBeTruthy();
    expect(screen.getByText('Could not load responses.')).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    expect(state.loadFor).toHaveBeenCalledWith('memory');
  });
});
