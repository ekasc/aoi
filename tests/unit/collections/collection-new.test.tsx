import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import NewListScreen from '@/app/(app)/collection/new';

const mocks = vi.hoisted(() => ({ create: vi.fn(), back: vi.fn() }));

vi.mock('@/features/collections/collections-context', () => ({
  useCollections: () => ({ createCollection: mocks.create }),
}));

vi.mock('expo-router', () => {
  const Toolbar = ({ children }: { children: ReactNode }) => createElement('div', null, children);
  Toolbar.Button = function ToolbarButton({ children, disabled, onPress }: { children: string; disabled?: boolean; onPress: () => void }) {
    return createElement('button', { 'aria-label': children, disabled, onClick: onPress }, children);
  };
  return { useRouter: () => ({ back: mocks.back }), Stack: { Screen: () => null, Toolbar } };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: 'created' });
  vi.stubEnv('EXPO_OS', 'ios');
});

afterEach(() => vi.unstubAllEnvs());

describe('Create list sheet', () => {
  it('creates the chosen name and colour, then dismisses', async () => {
    render(<NewListScreen />);
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: '  Places together  ' } });
    fireEvent.click(screen.getByLabelText('Sky'));
    fireEvent.click(screen.getByLabelText('Create'));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ name: 'Places together', color: 'sky' }));
    await waitFor(() => expect(mocks.back).toHaveBeenCalledOnce());
  });

  it('retains the draft after failure and dismisses only after a successful retry', async () => {
    mocks.create.mockRejectedValueOnce(new Error('Unavailable'));
    render(<NewListScreen />);
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Places together' } });
    fireEvent.click(screen.getByLabelText('Sage'));
    fireEvent.click(screen.getByLabelText('Create'));
    await screen.findByText("Couldn't save this list. Your draft is still here.");
    expect(mocks.back).not.toHaveBeenCalled();
    expect((screen.getByLabelText('List name') as HTMLInputElement).value).toBe('Places together');
    fireEvent.click(screen.getByLabelText('Create'));
    await waitFor(() => expect(mocks.back).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenLastCalledWith({ name: 'Places together', color: 'sage' });
  });

  it('cancels without creating a list', () => {
    render(<NewListScreen />);
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Unfinished' } });
    fireEvent.click(screen.getByLabelText('Cancel'));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.back).toHaveBeenCalledOnce();
  });
});
