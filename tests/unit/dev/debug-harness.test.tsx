import { render, screen } from '@testing-library/react';
import * as ReactNative from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DebugHarness } from '@/components/dev/debug-harness';

const state = vi.hoisted(() => ({ selecting: false, cancel: vi.fn() }));
vi.mock('@/features/dev/debug-capture', () => ({
  getPendingSelection: () => state.selecting ? state : null,
  subscribeSelection: () => () => {},
  cancelSelection: state.cancel,
  completeSelection: vi.fn(),
}));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#444444' }));

beforeEach(() => {
  state.selecting = false;
  vi.stubGlobal('__DEV__', true);
  vi.spyOn(ReactNative, 'Modal').mockImplementation(({ visible, children }) => visible ? <div role="dialog">{children}</div> : null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('__DEV__', false);
});

describe('debug wrapper without floating chrome', () => {
  it('renders the app without a copy button in development', () => {
    render(<DebugHarness><span>Us</span></DebugHarness>);
    expect(screen.getByText('Us')).toBeTruthy();
    expect(screen.queryByLabelText("Copy this screen's elements")).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('still mounts the element picker when an agent requests selection', () => {
    state.selecting = true;
    render(<DebugHarness><span>Us</span></DebugHarness>);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('Tap an element to send it to the agent')).toBeTruthy();
    expect(screen.queryByLabelText("Copy this screen's elements")).toBeNull();
  });
  it('leaves production children untouched', () => {
    vi.stubGlobal('__DEV__', false);
    render(<DebugHarness><button>App control</button></DebugHarness>);
    expect(screen.getByText('App control')).toBeTruthy();
    expect(screen.queryByLabelText("Copy this screen's elements")).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
