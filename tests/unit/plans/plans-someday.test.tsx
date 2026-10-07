import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import type { SomedayItem } from '@/features/someday/types';

const mocks = vi.hoisted(() => ({
  addItem: vi.fn(async () => {}),
  setChecked: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
}));

const state = vi.hoisted(() => ({
  openItems: [] as SomedayItem[],
  doneItems: [] as SomedayItem[],
  isLoading: false,
  error: null as string | null,
}));

vi.mock('@/features/someday/someday-context', () => ({
  useSomeday: () => ({
    items: [...state.openItems, ...state.doneItems],
    openItems: state.openItems,
    doneItems: state.doneItems,
    isLoading: state.isLoading,
    error: state.error,
    addItem: mocks.addItem,
    setChecked: mocks.setChecked,
    reload: mocks.reload,
  }),
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: { partnerName: 'June' } }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

import { PlansSomeday } from '@/components/calendar/plans-someday';

function makeItem(overrides: Partial<SomedayItem> = {}): SomedayItem {
  return {
    id: 'someday-1',
    title: 'A picnic on the hill',
    category: 'place',
    createdByRole: 'you',
    createdAt: '2026-07-01T10:00:00.000Z',
    checkedAt: null,
    checkedByRole: null,
    ...overrides,
  };
}

function renderSomeday() {
  return render(<PlansSomeday />);
}

beforeEach(() => {
  state.openItems = [];
  state.doneItems = [];
  state.isLoading = false;
  state.error = null;
  mocks.addItem.mockClear();
  mocks.setChecked.mockClear();
  mocks.reload.mockClear();
});

describe('Plans someday', () => {
  it('adds an idea with the chosen category from the quick-add', async () => {
    renderSomeday();

    const input = screen.getByLabelText('New someday idea');
    expect(input.getAttribute('maxlength')).toBe('120');

    fireEvent.change(input, { target: { value: 'Ramen crawl' } });
    fireEvent.click(screen.getByLabelText('Food'));
    fireEvent.click(screen.getByLabelText('Add'));

    await waitFor(() =>
      expect(mocks.addItem).toHaveBeenCalledWith({ title: 'Ramen crawl', category: 'food' }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('New someday idea') as HTMLInputElement).value).toBe(''),
    );
  });

  it('does not add an empty or whitespace-only draft', async () => {
    renderSomeday();

    fireEvent.click(screen.getByLabelText('Add'));
    fireEvent.change(screen.getByLabelText('New someday idea'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByLabelText('Add'));

    expect(mocks.addItem).not.toHaveBeenCalled();
  });

  it('groups open ideas under plural category headings', () => {
    state.openItems = [
      makeItem({ id: 'p', title: 'Kyoto in spring', category: 'place' }),
      makeItem({ id: 'f', title: 'Ramen crawl', category: 'food' }),
      makeItem({ id: 'm', title: 'Spirited Away', category: 'film' }),
      makeItem({ id: 'o', title: 'Learn to dance', category: 'other' }),
    ];
    renderSomeday();

    expect(screen.getByText('Places')).toBeTruthy();
    expect(screen.getByText('Food & drink')).toBeTruthy();
    expect(screen.getByText('Films')).toBeTruthy();
    expect(screen.getByText('Odds & ends')).toBeTruthy();

    // Each title sits under its own heading, not in one undifferentiated list.
    const places = screen.getByText('Places').parentElement as HTMLElement;
    expect(within(places).getByText('Kyoto in spring')).toBeTruthy();
    const films = screen.getByText('Films').parentElement as HTMLElement;
    expect(within(films).getByText('Spirited Away')).toBeTruthy();
  });

  it('names the partner when the idea was theirs', () => {
    state.openItems = [
      makeItem({ id: 'theirs', title: 'Night market', createdByRole: 'partner' }),
    ];
    renderSomeday();

    expect(screen.getByText('Added by June')).toBeTruthy();
  });

  it('checks an idea off through the real setChecked call', () => {
    state.openItems = [makeItem({ id: 'place-1', title: 'Kyoto in spring' })];
    renderSomeday();

    fireEvent.click(screen.getByLabelText('Check off Kyoto in spring'));

    expect(mocks.setChecked).toHaveBeenCalledWith('place-1', true);
  });

  it('lists done ideas only once the Done section is expanded, and undoes them', () => {
    state.doneItems = [
      makeItem({
        id: 'done-1',
        title: 'Ramen crawl',
        checkedAt: '2026-07-10T10:00:00.000Z',
        checkedByRole: 'partner',
      }),
    ];
    renderSomeday();

    // Collapsed by default: the row is not in the tree yet.
    expect(screen.queryByLabelText('Undo check-off: Ramen crawl')).toBeNull();

    fireEvent.click(screen.getByLabelText('Done together, 1 idea'));

    const undo = screen.getByLabelText('Undo check-off: Ramen crawl');
    expect(screen.getByText('Checked off by June')).toBeTruthy();
    fireEvent.click(undo);

    expect(mocks.setChecked).toHaveBeenCalledWith('done-1', false);
  });

  it('keeps an empty read distinct from a failed one, each with a next action', () => {
    const { unmount } = renderSomeday();

    // Empty: an honest line, and the quick-add above it is the next action.
    expect(screen.getByText('Nothing on your someday list yet.')).toBeTruthy();
    expect(screen.getByLabelText('Add')).toBeTruthy();
    unmount();

    state.error = 'Your someday list could not be loaded right now.';
    renderSomeday();

    // Failed: the error is stated, not dressed up as empty, and there is a retry.
    expect(screen.queryByText('Nothing on your someday list yet.')).toBeNull();
    expect(screen.getByText('Your someday list could not be loaded right now.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Try again'));
    expect(mocks.reload).toHaveBeenCalled();
  });

  it('shows a spinner while the first read is in flight', () => {
    state.isLoading = true;
    renderSomeday();

    expect(screen.queryByText('Nothing on your someday list yet.')).toBeNull();
    expect(screen.getByLabelText('Add')).toBeTruthy();
  });
});
