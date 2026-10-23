import { act, render } from '@testing-library/react';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NativeSheet } from '@/components/ui/native-sheet';

/**
 * Models the installed `@expo/ui` sheet:
 * - its presented state is committed by a render, so a callback fired before
 *   that render still sees the sheet as open and `present()` is ignored;
 * - `close()` starts an asynchronous dismissal that ends by committing the
 *   closed state and firing `onClose` in the same batch.
 */
const sheet = vi.hoisted(() => ({
  open: false,
  presentCalls: 0,
  presentWhileOpen: 0,
  closeCalls: 0,
  closeWhileClosed: 0,
  dismiss: () => {},
  finishDismiss: () => {},
}));

vi.mock('@expo/ui/community/bottom-sheet', () => ({
  BottomSheetModal: ({ ref, onClose }: {
    ref: Ref<{ present: () => void; close: () => void }>;
    onClose: () => void;
  }) => {
    const [open, setOpen] = useState(false);
    const openRef = useRef(open);
    openRef.current = open;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const pendingDismiss = useRef<null | (() => void)>(null);

    useImperativeHandle(ref, () => ({
      present: () => {
        sheet.presentCalls += 1;
        // Native present() lands on nothing while the sheet still reports open.
        if (openRef.current) {
          sheet.presentWhileOpen += 1;
          return;
        }
        setOpen(true);
      },
      close: () => {
        sheet.closeCalls += 1;
        if (!openRef.current) {
          sheet.closeWhileClosed += 1;
          return;
        }
        pendingDismiss.current = () => {
          setOpen(false);
          onCloseRef.current();
        };
      },
    }), []);

    sheet.open = open;
    // A user dismissal (drag or backdrop) closes and reports in one gesture.
    sheet.dismiss = () => {
      if (!open) return;
      setOpen(false);
      onCloseRef.current();
    };
    // Completion of a programmatic close.
    sheet.finishDismiss = () => {
      const finish = pendingDismiss.current;
      pendingDismiss.current = null;
      finish?.();
    };
    return null;
  },
}));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#181018' }));

beforeEach(() => {
  sheet.open = false;
  sheet.presentCalls = 0;
  sheet.presentWhileOpen = 0;
  sheet.closeCalls = 0;
  sheet.closeWhileClosed = 0;
  sheet.dismiss = () => {};
  sheet.finishDismiss = () => {};
});

describe('Native sheet transition ordering', () => {
  it('reopens only after the dismissal commits and the reopened sheet still dismisses', () => {
    const onClose = vi.fn();
    const { rerender } = render(<NativeSheet visible onClose={onClose}>Body</NativeSheet>);
    expect(sheet.presentCalls).toBe(1);
    expect(sheet.open).toBe(true);

    rerender(<NativeSheet visible={false} onClose={onClose}>Body</NativeSheet>);
    expect(sheet.closeCalls).toBe(1);
    rerender(<NativeSheet visible onClose={onClose}>Body</NativeSheet>);
    // Still dismissing: presenting now would land on an open sheet.
    expect(sheet.presentCalls).toBe(1);

    act(() => sheet.finishDismiss());
    expect(sheet.presentCalls).toBe(2);
    expect(sheet.presentWhileOpen).toBe(0);
    expect(sheet.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    // The reopened sheet must still deliver its own gesture dismissal.
    act(() => sheet.dismiss());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('honors a cancelled reopen without issuing overlapping native closes', () => {
    const onClose = vi.fn();
    const { rerender } = render(<NativeSheet visible onClose={onClose}>Body</NativeSheet>);
    rerender(<NativeSheet visible={false} onClose={onClose}>Body</NativeSheet>);
    rerender(<NativeSheet visible onClose={onClose}>Body</NativeSheet>);
    rerender(<NativeSheet visible={false} onClose={onClose}>Body</NativeSheet>);

    expect(sheet.closeCalls).toBe(1);
    act(() => sheet.finishDismiss());
    expect(sheet.presentCalls).toBe(1);
    expect(sheet.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not run another close animation after a gesture dismissal', () => {
    const onClose = vi.fn();
    const { rerender } = render(<NativeSheet visible onClose={onClose}>Body</NativeSheet>);
    act(() => sheet.dismiss());
    rerender(<NativeSheet visible={false} onClose={onClose}>Body</NativeSheet>);
    expect(sheet.closeCalls).toBe(0);
    act(() => sheet.dismiss());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the current completion callback when dismissal finishes', () => {
    const oldClose = vi.fn();
    const newClose = vi.fn();
    const { rerender } = render(<NativeSheet visible onClose={oldClose}>Body</NativeSheet>);
    rerender(<NativeSheet visible={false} onClose={newClose}>Body</NativeSheet>);
    act(() => sheet.finishDismiss());
    expect(oldClose).not.toHaveBeenCalled();
    expect(newClose).toHaveBeenCalledTimes(1);
  });
});
