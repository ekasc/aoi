import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UsScreen from '@/app/(app)/(tabs)/together';
import type { SkyPhoto } from '@/features/album/sky-photo-repository';
import type { ViewerPhoto } from '@/components/moments/photo-viewer';

const state = vi.hoisted(() => ({
  photos: [] as SkyPhoto[], letters: [] as Record<string, unknown>[], status: 'ready', readError: null as string | null,
  operation: null as string | null, scopeKey: 'album-a', reload: vi.fn(),
  sendSqueeze: vi.fn(), isSending: false, lastSentAt: null, push: vi.fn(), isPlus: true,
}));
vi.mock('@/features/album/use-sky-photos', () => ({ useSkyPhotos: () => state }));
vi.mock('@/features/letters/letters-context', () => ({ useLetters: () => ({ letters: state.letters }) }));
vi.mock('@/features/squeeze/squeeze-context', () => ({ useSqueeze: () => state }));
vi.mock('@/features/space/space-context', () => ({ useSpace: () => ({ space: { relationshipStartDate: '2026-03-10' } }) }));
vi.mock('@/features/dev/preview', () => ({ usePreviewVariant: () => ({ active: false, variant: 'full' }), skyPreviewStart: () => ({ monthsBack: 0, entitlement: null }) }));
vi.mock('@/features/haptics/haptics', () => ({ haptics: { select: vi.fn() } }));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#444444' }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: state.push }), useIsFocused: () => true, useFocusEffect: () => {} }));
vi.mock('@/features/subscription/subscription-context', () => ({ useSubscription: () => ({ isPlus: state.isPlus }) }));
vi.mock('@/components/home/memory-sky', () => ({ MemorySky: ({ moments, daysTogether, presentationHeight, starLimit }: { moments: { id: string }[]; daysTogether?: number; presentationHeight: number; starLimit: number | null }) => <div data-testid="sky" data-days={daysTogether} data-height={presentationHeight} data-limit={String(starLimit)} data-items={moments.map((item) => item.id).join(',')} />, SYSTEM_TAB_BAR_IOS_CLEARANCE: 50 }));
vi.mock('@/components/home/photo-sky-viewport', async () => {
  const { MemorySky } = await import('@/components/home/memory-sky');
  return { PhotoSkyViewport: ({ moments, height, canOpen, onOpenPhoto }: { moments: { id: string; occurredAt: string; authorRole: 'you' }[]; height: number; canOpen: boolean; onOpenPhoto: (id?: string) => void }) => <div>
    <button aria-label="Photo sky" disabled={!canOpen} onClick={() => onOpenPhoto()}><MemorySky moments={moments} presentationHeight={height} starLimit={null} photoStars immersive /></button>
    {moments.map((item) => <button key={item.id} aria-label={`Open star ${item.id}`} disabled={!canOpen} onClick={() => onOpenPhoto(item.id)} />)}
  </div> };
});
vi.mock('@/components/album/local-photos-sheet', () => ({ LocalPhotosSheet: ({ visible }: { visible: boolean }) => visible ? <div>Manage local photos</div> : null }));
vi.mock('@/components/moments/photo-viewer', () => ({ PhotoViewer: ({ visible, photos, onClose }: { visible: boolean; photos: ViewerPhoto[]; onClose: () => void }) => visible ? <div role="dialog" aria-label="Photo"><span>{photos[0]?.uri}</span><button onClick={onClose}>Close photo</button></div> : null }));
vi.mock('@/components/ui/button', () => ({ Button: ({ label, accessibilityLabel, disabled, onPress }: { label: string; accessibilityLabel?: string; disabled?: boolean; onPress: () => void }) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{label}</button> }));

const photo = (id: string, addedAt = '2026-08-15T12:00:00'): SkyPhoto => ({ id, addedAt, uri: `file://${id}.jpg`, width: 100, height: 100 });
const press = async (element: Element) => { await act(async () => { fireEvent.click(element); }); };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T20:00:00'));
  Object.assign(state, { photos: [], letters: [], status: 'ready', readError: null, operation: null, scopeKey: 'album-a', isPlus: true, isSending: false });
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
    expect(screen.getByText('No photos in your album yet.')).toBeTruthy();
    await press(screen.getByText('Choose photos'));
    expect(screen.getByText('Manage local photos')).toBeTruthy();
    state.status = 'loading'; rerender(<UsScreen />);
    expect(screen.getByText('Opening your local photos…')).toBeTruthy();
    expect(screen.queryByText('No photos in your album yet.')).toBeNull();
    state.status = 'failed'; state.readError = 'Could not open your local photos.'; rerender(<UsScreen />);
    await press(screen.getByText('Try again')); expect(state.reload).toHaveBeenCalledOnce();
    state.status = 'ready'; state.readError = null; state.photos = [{ ...photo('gone'), uri: null }]; rerender(<UsScreen />);
    expect(screen.getByText('Your album photos are unavailable on this device.')).toBeTruthy();
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
    await press(screen.getByText('Today'));
    expect(screen.getByTestId('sky').getAttribute('data-items')).toBe('old,new');
  });
  it('reaches the first day with an honest empty state', async () => {
    state.photos = [photo('later')];
    render(<UsScreen />);
    await press(screen.getByLabelText('Revisit your sky'));
    for (let i = 0; i < 7; i++) await press(screen.getByLabelText('Earlier date'));
    expect(screen.getByText(/Mar 10, 2026 · 1 day together/)).toBeTruthy();
    expect(screen.getByText('No photos in your sky at this date.')).toBeTruthy();
    expect(screen.getByTestId('sky').getAttribute('data-items')).toBe('');
    await press(screen.getByText('Return to today'));
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
  it('keeps the populated sky free of extra labels and shortcuts', () => {
    state.photos = [photo('one')];
    render(<UsScreen />);
    for (const label of ['✦', 'Squeeze', 'Ready', 'Bring out a photo', 'Photos on this device', 'Tap the sky for a photo of the two of you.']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.getByLabelText('Photo sky')).toBeTruthy();
  });
});
