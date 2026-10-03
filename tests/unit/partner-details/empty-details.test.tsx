import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LittleThingsScreen from '@/app/(app)/profile/little-things';
import { PartnerDetailsProvider, usePartnerDetails } from '@/features/partner-details/partner-details-context';

const repository = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn(), remove: vi.fn() }));

vi.mock('@/features/partner-details/partner-details-repository', () => ({ partnerDetailsRepository: repository }));
vi.mock('@/features/session/session-context', () => ({ useSession: () => ({ user: { id: 'you' } }) }));
vi.mock('@/features/space/space-context', () => ({ useSpace: () => ({ space: { partnerName: 'June' } }) }));
vi.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#000000' }));

beforeEach(() => {
  repository.list.mockReset();
  repository.list.mockResolvedValue([]);
  repository.add.mockReset();
  repository.remove.mockReset();
});

describe('Little things empty states', () => {
  it('recovers from a failed read without navigating away', async () => {
    repository.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    render(<PartnerDetailsProvider><LittleThingsScreen /></PartnerDetailsProvider>);
    await screen.findByText('Could not load your details.');
    fireEvent.click(screen.getByText('Try again'));
    expect(await screen.findByText('No details yet.')).toBeTruthy();
    expect(screen.queryByText('Could not load your details.')).toBeNull();
    expect(repository.list).toHaveBeenCalledTimes(2);
  });

  it('retains previously loaded details if a refresh fails', async () => {
    const detail = { id: 'detail', text: 'Tea', category: 'favorite', createdAt: '2026-01-01T00:00:00.000Z' };
    repository.list.mockResolvedValueOnce([detail]).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => usePartnerDetails(), { wrapper: ({ children }) => <PartnerDetailsProvider>{children}</PartnerDetailsProvider> });
    await waitFor(() => expect(result.current.details).toEqual([detail]));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.details).toEqual([detail]);
  });
  it('does not add a ghost detail when saving fails', async () => {
    repository.add.mockRejectedValue(new Error('private network failure'));
    const { result } = renderHook(() => usePartnerDetails(), { wrapper: ({ children }) => <PartnerDetailsProvider>{children}</PartnerDetailsProvider> });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await expect(result.current.addDetail({ text: 'Tea without sugar' })).rejects.toThrow(); });
    expect(result.current.details).toEqual([]);
  });

  it('does not remove a detail from state before the repository accepts the delete', async () => {
    const detail = { id: 'detail', text: 'Tea', category: 'favorite', createdAt: '2026-01-01T00:00:00.000Z' };
    repository.list.mockResolvedValue([detail]);
    repository.remove.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => usePartnerDetails(), { wrapper: ({ children }) => <PartnerDetailsProvider>{children}</PartnerDetailsProvider> });
    await waitFor(() => expect(result.current.details).toEqual([detail]));
    await act(async () => { await expect(result.current.removeDetail(detail.id)).rejects.toThrow('offline'); });
    expect(result.current.details).toEqual([detail]);
  });
  it('shows the empty indicator and prompts after a successful empty read', async () => {
    render(<PartnerDetailsProvider><LittleThingsScreen /></PartnerDetailsProvider>);
    expect(await screen.findByText('No details yet.')).toBeTruthy();
    expect(screen.getByText('Need a spark?')).toBeTruthy();
  });

  it('does not present a pending read as empty', async () => {
    let complete: (() => void) | undefined;
    repository.list.mockReturnValue(new Promise((resolve) => { complete = () => resolve([]); }));
    render(<PartnerDetailsProvider><LittleThingsScreen /></PartnerDetailsProvider>);
    expect(screen.getByText('Loading details…')).toBeTruthy();
    expect(screen.queryByText('No details yet.')).toBeNull();
    await act(async () => complete?.());
    expect(await screen.findByText('No details yet.')).toBeTruthy();
  });

  it('does not turn a storage failure into an empty collection', async () => {
    repository.list.mockRejectedValue(new Error('private storage failure'));
    const { result } = renderHook(() => usePartnerDetails(), {
      wrapper: ({ children }) => <PartnerDetailsProvider>{children}</PartnerDetailsProvider>,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('Could not load your details.');
    render(<PartnerDetailsProvider><LittleThingsScreen /></PartnerDetailsProvider>);
    expect(await screen.findByText('Could not load your details.')).toBeTruthy();
    expect(screen.queryByText('No details yet.')).toBeNull();
  });
});
