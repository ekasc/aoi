import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as ReactNative from 'react-native';

import UsScreen from '@/app/(app)/(tabs)/together';
import type { Moment } from '@/features/moments/types';
import type { CalendarEvent } from '@/features/calendar/types';

const state = vi.hoisted(() => ({
  moments: [] as Moment[], letters: [] as Record<string, unknown>[], upcomingEvents: [] as CalendarEvent[],
  isLoading: false, error: null as string | null, hasMore: false, isPaging: false, pagingError: null as string | null,
  pending: [], sendingIds: [], loadMore: vi.fn(), refresh: vi.fn(), setSelectedDate: vi.fn(),
  sendSqueeze: vi.fn(), isSending: false, lastSentAt: null as string | null, push: vi.fn(), startDate: '2022-06-01' as string | null,
}));
vi.mock('@/features/moments/use-story-feed', () => ({ useStoryFeed: () => state }));
vi.mock('@/features/calendar/calendar-context', () => ({ useCalendar: () => ({ ...state, error: null }) }));
vi.mock('@/features/letters/letters-context', () => ({ useLetters: () => ({ letters: state.letters, error: null }) }));
vi.mock('@/features/squeeze/squeeze-context', () => ({ useSqueeze: () => state }));
vi.mock('@/features/space/space-context', () => ({ useSpace: () => ({ space: { id: 'space', relationshipStartDate: state.startDate } }) }));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#444444' }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: state.push }), useIsFocused: () => true, useFocusEffect: () => {} }));
vi.mock('@/features/album/use-sky-photos', () => ({ useSkyPhotos: () => { throw new Error('Us must not read device photos'); } }));
vi.mock('@/features/album/automatic-album-state', () => ({ useAutomaticAlbum: () => { throw new Error('Us must not mount recognition'); } }));
vi.mock('@/features/subscription/subscription-context', () => ({ useSubscription: () => { throw new Error('Us is the same for Free and Plus'); } }));
vi.mock('@/components/home/memory-sky', () => ({ MemorySky: ({ moments, daysTogether }: { moments: { id: string }[]; daysTogether: number }) => <div data-testid="sky" data-days={daysTogether} data-items={moments.map((item) => item.id).join(',')} />, SYSTEM_TAB_BAR_IOS_CLEARANCE: 50 }));
vi.mock('@/components/moments/pending-memory-row', () => ({ PendingMemoryRow: () => <div>Pending memory</div> }));
vi.mock('@/components/moments/moment-card', () => ({ MomentCard: ({ moment }: { moment: Moment }) => <div>{moment.title || moment.body}</div> }));
vi.mock('@/components/ui/button', () => ({ Button: ({ label, accessibilityLabel, disabled, onPress }: { label: string; accessibilityLabel?: string; disabled?: boolean; onPress: () => void }) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{label}</button> }));

const memory = (id: string, occurredAt: string): Moment => ({ id, occurredAt, type: 'note', title: id, body: 'Kept together', createdAt: occurredAt, authorId: 'june', authorRole: 'partner', authorName: 'June' });
const press = async (element: Element) => { await act(async () => fireEvent.click(element)); };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-05T20:00:00'));
  vi.spyOn(ReactNative, 'FlatList').mockImplementation(({ data, renderItem, ListHeaderComponent }) => <div>{ListHeaderComponent as ReactNode}{data?.map((item, index) => <div key={index}>{renderItem?.({ item, index, separators: { highlight() {}, unhighlight() {}, updateProps() {} } })}</div>)}</div>);
  state.moments = []; state.letters = []; state.upcomingEvents = []; state.startDate = '2022-06-01';
  state.isLoading = false; state.error = null; state.hasMore = false; state.isPaging = false; state.pagingError = null;
  state.isSending = false; state.lastSentAt = null;
  vi.clearAllMocks();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Us shared relationship history', () => {
  it('shows an honest empty story and no invented sections or discovery promises', async () => {
    render(<UsScreen />);
    expect(screen.getByText('No shared memories yet.')).toBeTruthy();
    for (const label of ['Here with you', 'On this night', 'Our constellations', 'Find photos of us']) expect(screen.queryByText(label)).toBeNull();
    await press(screen.getByText('Keep our first memory'));
    expect(state.push).toHaveBeenCalledWith('/(app)/moment/new');
  });
  it('keeps read failures, loading, and empty results distinct', async () => {
    state.isLoading = true;
    const { rerender } = render(<UsScreen />);
    expect(screen.getByText('Opening your shared memories…')).toBeTruthy();
    expect(screen.queryByText('No shared memories yet.')).toBeNull();
    state.isLoading = false; state.error = 'offline'; rerender(<UsScreen />);
    expect(screen.getByText('Could not load your story.').getAttribute('accessibilityrole')).toBe('alert');
    await press(screen.getByText('Retry memories'));
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByText('No shared memories yet.')).toBeNull();
  });
  it('renders shared occurrence history oldest first and excludes goals and future dates from the sky', () => {
    state.moments = [memory('latest', '2026-09-04T20:00:00'), memory('oldest', '2024-02-01T20:00:00'), { ...memory('goal', '2024-01-01'), type: 'goal' }, memory('future', '2027-01-01')];
    render(<UsScreen />);
    expect(screen.getByTestId('sky').getAttribute('data-items')).toBe('oldest,latest');
    expect(screen.getByText('Here with you')).toBeTruthy();
    expect(screen.queryByText('goal')).toBeNull();
    expect(screen.getByTestId('sky').getAttribute('data-days')).toBe('1558');
  });
  it('keeps sealed contents private and links only a ready letter', async () => {
    state.letters = [{ id: 'letter', caption: 'Private caption', body: 'SECRET', isOpened: false, sealedUntil: '2020-01-01', createdAt: '2020-01-01' }];
    const { rerender } = render(<UsScreen />);
    expect(screen.queryByText('SECRET')).toBeNull(); expect(screen.queryByText('Private caption')).toBeNull();
    await press(screen.getByText('A letter is ready to open'));
    expect(state.push).toHaveBeenCalledWith({ pathname: '/(app)/letter/[id]', params: { id: 'letter' } });
    state.letters = [{ ...state.letters[0], sealedUntil: '2099-01-01' }]; rerender(<UsScreen />);
    expect(screen.queryByText('A letter is ready to open')).toBeNull();
  });
  it('omits no-result resurfacing but opens a real historical memory when eligible', async () => {
    state.moments = [memory('last-year', '2025-09-05T20:00:00')];
    render(<UsScreen />);
    expect(screen.getByText('On this night')).toBeTruthy();
    await press(screen.getByLabelText('Open this memory'));
    expect(state.push).toHaveBeenCalledWith({ pathname: '/(app)/moment/[id]', params: { id: 'last-year', at: '2025-09-05T20:00:00' } });
  });
  it('opens an existing relationship-year chapter, never an invented collection', async () => {
    state.moments = [memory('one', '2024-07-01'), memory('two', '2024-08-01')];
    render(<UsScreen />);
    await press(screen.getByLabelText('Open Three years together chapter'));
    expect(state.push).toHaveBeenCalledWith({ pathname: '/(app)/chapter/[id]', params: { id: 'anniversary:3:2025' } });
  });
  it('retains manual paging and archive navigation', async () => {
    state.hasMore = true; state.pagingError = 'offline'; state.moments = [memory('one', '2024-07-01')];
    render(<UsScreen />);
    await press(screen.getByText('Retry earlier memories')); expect(state.loadMore).toHaveBeenCalledOnce();
    await press(screen.getByText('Open Memories')); expect(state.push).toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });
  it('preserves Squeeze without a second send during delivery', async () => {
    const { rerender } = render(<UsScreen />);
    await press(screen.getByLabelText('Squeeze')); expect(state.sendSqueeze).toHaveBeenCalledOnce();
    state.isSending = true; rerender(<UsScreen />);
    await press(screen.getByLabelText('Squeeze')); expect(state.sendSqueeze).toHaveBeenCalledOnce();
  });
  it('uses existing deliberate sharing routes for letters and Little things', async () => {
    render(<UsScreen />);
    await press(screen.getByText('Letters')); await press(screen.getByText('Little things'));
    expect(state.push.mock.calls).toEqual([['/(app)/letters'], ['/(app)/profile/little-things']]);
  });
});
