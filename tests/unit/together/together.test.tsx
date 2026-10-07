import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UsScreen from '@/app/(app)/(tabs)/together';
import type { SkyPhoto } from '@/features/album/sky-photo-repository';
import type { ViewerPhoto } from '@/components/moments/photo-viewer';

const state = vi.hoisted(() => ({
  photos: [] as SkyPhoto[], letters: [] as Record<string, unknown>[], status: 'ready', readError: null as string | null,
  operation: null as string | null, actionError: null as string | null, scopeKey: 'album-a', reload: vi.fn(), choosePhotos: vi.fn().mockResolvedValue(undefined),
  sendSqueeze: vi.fn(), isSending: false, lastSentAt: null, push: vi.fn(), isPlus: true, startDate: '2026-03-10' as string | null,
}));
vi.mock('@/features/album/use-sky-photos', () => ({ useSkyPhotos: () => state }));
vi.mock('@/features/letters/letters-context', () => ({ useLetters: () => ({ letters: state.letters }) }));
vi.mock('@/features/squeeze/squeeze-context', () => ({ useSqueeze: () => state }));
vi.mock('@/features/space/space-context', () => ({ useSpace: () => ({ space: { relationshipStartDate: state.startDate } }) }));
vi.mock('@/features/dev/preview', () => ({ usePreviewVariant: () => ({ active: false, variant: 'full' }), skyPreviewStart: () => ({ monthsBack: 0, entitlement: null }) }));
vi.mock('@/features/haptics/haptics', () => ({ haptics: { select: vi.fn() } }));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#444444' }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: state.push }), useIsFocused: () => true, useFocusEffect: () => {} }));
vi.mock('@/features/subscription/subscription-context', () => ({ useSubscription: () => ({ isPlus: state.isPlus }) }));
vi.mock('@/components/home/memory-sky', () => ({ MemorySky: ({ moments, daysTogether, presentationHeight, starLimit }: { moments: { id: string }[]; daysTogether?: number; presentationHeight: number; starLimit: number | null }) => <div data-testid="sky" data-days={daysTogether} data-height={presentationHeight} data-limit={String(starLimit)} data-items={moments.map((item) => item.id).join(',')} />, SYSTEM_TAB_BAR_IOS_CLEARANCE: 50 }));
vi.mock('@/components/home/photo-sky-viewport', async () => {
  const { MemorySky } = await import('@/components/home/memory-sky');
  return { PhotoSkyViewport: ({ moments, height, focused, canOpen, onOpenPhoto }: { moments: { id: string; occurredAt: string; authorRole: 'you' }[]; height: number; focused: boolean; canOpen: boolean; onOpenPhoto: (id?: string) => void }) => <div data-testid="sky-interaction" data-focused={focused}>
    <button aria-label="Photo sky" disabled={!canOpen} onClick={() => onOpenPhoto()}><MemorySky moments={moments} presentationHeight={height} starLimit={null} photoStars immersive /></button>
    {moments.map((item) => <button key={item.id} aria-label={`Open star ${item.id}`} disabled={!canOpen} onClick={() => onOpenPhoto(item.id)} />)}
  </div> };
});
vi.mock('@/components/space/space-avatar-button', () => ({ SpaceAvatarButton: () => null }));
vi.mock('@/components/moments/photo-viewer', () => ({ PhotoViewer: ({ visible, photos, onClose }: { visible: boolean; photos: ViewerPhoto[]; onClose: () => void }) => visible ? <div role="dialog" aria-label="Photo"><span>{photos[0]?.uri}</span><button onClick={onClose}>Close photo</button></div> : null }));

const photo = (id: string, addedAt = '2026-08-15T12:00:00'): SkyPhoto => ({ id, addedAt, uri: `file://${id}.jpg`, width: 100, height: 100 });
const press = async (element: Element) => { await act(async () => { fireEvent.click(element); }); };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T20:00:00'));
  Object.assign(state, { photos: [], letters: [], status: 'ready', readError: null, operation: null, actionError: null, scopeKey: 'album-a', isPlus: true, isSending: false, startDate: '2026-03-10' });
  vi.clearAllMocks();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Us photo sky', () => {
  it('restores a viewport-height photo sky without the editorial feed or a day-driven field', () => {
    state.photos = Array.from({ length: 81 }, (_, i) => photo(`photo-${i}`));
    render(<UsScreen />);
    const sky = screen.getByTestId('sky');
    expect(Number(sky.getAttribute('data-height'))).toBeGreaterThan(600);
    expect(sky.getAttribute('data-items')?.split(',')).toHaveLength(81);
    expect(sky.getAttribute('data-limit')).toBe('null');
    expect(sky.hasAttribute('data-days')).toBe(false);
    expect(screen.queryByText('Our story')).toBeNull();
    expect(screen.queryByText('Our sky')).toBeNull();
    expect(screen.queryByLabelText('Sky history')).toBeNull();
  });
  it('adds a newly imported photo to today without waiting for a focus refresh', () => {
    const { rerender } = render(<UsScreen />);
    state.photos = [photo('just-added', '2026-09-15T20:00:05')];
    rerender(<UsScreen />);
    expect(screen.getByTestId('sky').getAttribute('data-items')).toBe('just-added');
  });
  it('opens a random available photo and avoids repeating it on the next tap', async () => {
    state.photos = [photo('one'), photo('two'), { ...photo('missing'), uri: null }];
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<UsScreen />);
    await press(screen.getByLabelText('Photo sky'));
    expect(screen.getByRole('dialog').textContent).toContain('file://one.jpg');
    await press(screen.getByText('Close photo'));
    await press(screen.getByLabelText('Photo sky'));
    expect(screen.getByRole('dialog').textContent).toContain('file://two.jpg');
  });
  it('opens the specific photo chosen from a close-up star rather than a random neighbour', async () => {
    state.photos = [photo('one'), photo('two')];
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<UsScreen />);
    await press(screen.getByLabelText('Open star two'));
    expect(screen.getByRole('dialog').textContent).toContain('file://two.jpg');
  });
  it('distinguishes empty, loading, failed, and unavailable albums', async () => {
    const { rerender } = render(<UsScreen />);
    expect(screen.getByText('No photos yet.')).toBeTruthy();
    expect(screen.getByText('Choose photos')).toBeTruthy();
    expect(screen.queryByLabelText('Revisit your sky')).toBeNull();
    expect(screen.getByText('Photos are encrypted on this device. They appear to your partner in your shared sky.')).toBeTruthy();
    await press(screen.getByLabelText('Choose photos'));
    expect(state.choosePhotos).toHaveBeenCalledOnce();
    expect(screen.queryByText('Local photo copies')).toBeNull();
    state.status = 'loading'; rerender(<UsScreen />);
    expect(screen.getByText('Loading photos…')).toBeTruthy();
    expect(screen.queryByText('No photos yet.')).toBeNull();
    state.status = 'failed'; state.readError = 'Could not open your local photos.'; rerender(<UsScreen />);
    await press(screen.getByText('Try again')); expect(state.reload).toHaveBeenCalledOnce();
    state.status = 'ready'; state.readError = null; state.photos = [{ ...photo('gone'), uri: null }]; rerender(<UsScreen />);
    expect(screen.getByText('Photos unavailable on this device.')).toBeTruthy();
    expect(screen.getByText('Choose the photos again to restore their local copies, or add new favorites.')).toBeTruthy();
    expect(screen.getByLabelText('Choose photos')).toBeTruthy();
  });
  it('shows import progress without another picker trigger or an unavailable-photo error', () => {
    state.operation = 'importing';
    const { rerender } = render(<UsScreen />);
    expect(screen.getByText('Adding photos…')).toBeTruthy();
    expect(screen.queryByText('Choose photos')).toBeNull();
    expect(screen.getByLabelText('Choose photos').hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Photos unavailable on this device.')).toBeNull();
    state.photos = [photo('existing')]; rerender(<UsScreen />);
    expect(screen.getByText('Adding photos…')).toBeTruthy();
    expect(screen.queryByText('Photos unavailable on this device.')).toBeNull();
    expect(state.choosePhotos).not.toHaveBeenCalled();
  });
  it('returns to the empty chooser after cancellation and allows another attempt', async () => {
    state.operation = 'importing';
    const { rerender } = render(<UsScreen />);
    state.operation = null; rerender(<UsScreen />);
    expect(screen.queryByText('Adding photos…')).toBeNull();
    await press(screen.getByLabelText('Choose photos'));
    expect(state.choosePhotos).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('surfaces import errors on the sky and keeps the picker available for retry', async () => {
    state.actionError = 'Could not add these photos. Please try again.';
    render(<UsScreen />);
    expect(screen.getByText(state.actionError).getAttribute('accessibilityrole')).toBe('alert');
    expect(screen.getByText('Photos are encrypted on this device. They appear to your partner in your shared sky.')).toBeTruthy();
    expect(screen.getByLabelText('Choose photos').getAttribute('accessibilityhint')).toContain('encrypted on this device');
    await press(screen.getByLabelText('Choose photos'));
    expect(state.choosePhotos).toHaveBeenCalledOnce();
  });
  it('keeps historical stars and random picks within the selected date and returns to today', async () => {
    state.photos = [photo('old', '2026-03-10T12:00:00'), photo('new', '2026-09-10T12:00:00')];
    render(<UsScreen />);
    await press(screen.getByLabelText('Revisit your sky'));
    await press(screen.getByLabelText('Earlier date'));
    expect(screen.getByTestId('sky').getAttribute('data-items')).toBe('old');
    await press(screen.getByLabelText('Photo sky'));
    expect(screen.getByRole('dialog').textContent).toContain('file://old.jpg');
    await press(screen.getByText('Close photo'));
    expect(screen.getByTestId('sky').getAttribute('data-items')).toBe('old');
    await press(screen.getByLabelText('Return to today'));
    expect(screen.getByTestId('sky').getAttribute('data-items')).toBe('old,new');
  });
  it('reaches the first day with an honest empty state', async () => {
    state.photos = [photo('later')];
    render(<UsScreen />);
    await press(screen.getByLabelText('Revisit your sky'));
    for (let i = 0; i < 7; i++) await press(screen.getByLabelText('Earlier date'));
    expect(screen.getByText(/Mar 10, 2026 · 1 day together/)).toBeTruthy();
    expect(screen.getByText('No photos at this date.')).toBeTruthy();
    expect(screen.getByTestId('sky').getAttribute('data-items')).toBe('');
    await press(screen.getByLabelText('Return to today'));
    expect(screen.getByTestId('sky').getAttribute('data-items')).toBe('later');
  });
  it('keeps free readers live and sends the history affordance to the existing paywall', async () => {
    state.photos = [photo('one')]; state.isPlus = false;
    render(<UsScreen />);
    await press(screen.getByLabelText('Photo sky'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await press(screen.getByText('Close photo'));
    await press(screen.getByLabelText('Revisit your sky, Plus feature'));
    expect(state.push).toHaveBeenCalledWith({ pathname: '/(app)/paywall', params: { feature: 'sky-history' } });
    expect(screen.queryByLabelText('Sky history')).toBeNull();
  });
  it('does not retain an open photo across an album scope change', async () => {
    state.photos = [photo('one')];
    const { rerender } = render(<UsScreen />);
    await press(screen.getByLabelText('Photo sky'));
    state.scopeKey = 'album-b'; rerender(<UsScreen />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('resets to today on remount and returns to live when Plus is lost', async () => {
    state.photos = [photo('new', '2026-09-10T12:00:00')];
    const first = render(<UsScreen />);
    await press(screen.getByLabelText('Revisit your sky'));
    await press(screen.getByLabelText('Earlier date'));
    expect(screen.getByTestId('sky').getAttribute('data-items')).toBe('');
    state.isPlus = false; first.rerender(<UsScreen />);
    expect(screen.getByTestId('sky').getAttribute('data-items')).toBe('new');
    first.unmount(); state.isPlus = true; render(<UsScreen />);
    expect(screen.getByTestId('sky').getAttribute('data-items')).toBe('new');
  });
  it('keeps the selected date visible after closing history', async () => {
    state.photos = [photo('one')];
    render(<UsScreen />);
    await press(screen.getByLabelText('Revisit your sky'));
    await press(screen.getByLabelText('Earlier date'));
    await press(screen.getByLabelText('Revisit your sky'));
    expect(screen.queryByLabelText('Sky history')).toBeNull();
    expect(screen.getByText('Aug 2026')).toBeTruthy();
    await press(screen.getByLabelText('Return to today'));
    expect(screen.queryByText('Aug 2026')).toBeNull();
  });
  it('keeps the sky interactive when Plus is lost with history open', async () => {
    state.photos = [photo('one')];
    const { rerender } = render(<UsScreen />);
    await press(screen.getByLabelText('Revisit your sky'));
    state.isPlus = false;
    rerender(<UsScreen />);
    expect(screen.getByTestId('sky-interaction').getAttribute('data-focused')).toBe('true');
  });
  it('offers optional gesture help and restores interaction when dismissed', async () => {
    state.photos = [photo('one')];
    render(<UsScreen />);
    await press(screen.getByLabelText('About your photo sky'));
    expect(screen.getByText('Tap the sky to open a photo. Pinch to zoom, then drag to explore.')).toBeTruthy();
    expect(screen.getByTestId('sky-interaction').getAttribute('data-focused')).toBe('false');
    await press(screen.getByLabelText('Manage photos'));
    expect(state.push).toHaveBeenCalledWith('/(app)/album/local-photos');
    await press(screen.getByLabelText('About your photo sky'));
    expect(screen.queryByText('How to explore')).toBeNull();
    expect(screen.getByTestId('sky-interaction').getAttribute('data-focused')).toBe('true');
  });
  it('returns to today before choosing photos so additions are not hidden in history', async () => {
    state.photos = [photo('one')];
    render(<UsScreen />);
    await press(screen.getByLabelText('Revisit your sky'));
    await press(screen.getByLabelText('Earlier date'));
    await press(screen.getByLabelText('Choose photos'));
    expect(state.choosePhotos).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Sky history')).toBeNull();
    expect(screen.queryByText('Aug 2026')).toBeNull();
    expect(screen.getByTestId('sky-interaction').getAttribute('data-focused')).toBe('true');
  });
  it('explains how to unlock date navigation when the relationship date is missing', async () => {
    state.photos = [photo('one')];
    state.startDate = null;
    render(<UsScreen />);
    await press(screen.getByLabelText('Revisit your sky'));
    expect(screen.queryByLabelText('Sky history')).toBeNull();
    expect(screen.getByText('Add your relationship start date to explore earlier skies.')).toBeTruthy();
    await press(screen.getByLabelText('Set our start date'));
    expect(state.push).toHaveBeenCalledWith('/(app)/profile/edit-relationship');
  });
  it('keeps the populated sky free of extra labels and shortcuts', () => {
    state.photos = [photo('one')];
    render(<UsScreen />);
    for (const label of ['✦', 'Squeeze', 'Ready', 'Bring out a photo', 'Photos on this device', 'Tap the sky for a photo of the two of you.']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.getByText('Us')).toBeTruthy();
    expect(screen.getByLabelText('Choose photos').style.right).toBe('24px');
    expect(screen.getByLabelText('Choose photos').style.width).toBe('56px');
    expect(screen.getByLabelText('Choose photos').style.borderRadius).toBe('28px');
    expect(screen.queryByText('Revisit your sky')).toBeNull();
    expect(screen.queryByText('Hide history')).toBeNull();
    expect(screen.queryByText(' · Plus')).toBeNull();
    expect(screen.getByLabelText('Revisit your sky').getAttribute('accessibilityrole')).toBe('button');
    expect(screen.getByLabelText('Photo sky')).toBeTruthy();
  });
});
