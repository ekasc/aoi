import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';

const onCloseSpy = vi.fn();

vi.mock('react-native', () => {
  const React = require('react');
  const flatten = (style: any) =>
    Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
  const View = ({ children, style, ...rest }: any) =>
    React.createElement('div', { style: flatten(style), ...rest }, children);
  const Pressable = ({ children, style, onPress, accessibilityLabel, ...rest }: any) => {
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    return React.createElement(
      'button',
      {
        ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
        ...(onPress ? { onClick: onPress } : {}),
        style: flatten(resolved),
        ...rest,
      },
      children
    );
  };
  return {
    View,
    Pressable,
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1, absoluteFill: {} },
  };
});

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: (_props: unknown, token: string) =>
    ({
      border: '#DDDDDD',
      muted: '#888888',
      danger: '#8F2F4B',
      text: '#111111',
    })[token] ?? '#000000',
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children, style }: any) =>
    createElement('span', { style }, children),
}));

describe('ActionSheet', () => {
  beforeEach(() => {
    onCloseSpy.mockClear();
  });

  async function renderSheet(props: Record<string, unknown> = {}) {
    const { ActionSheet } = await import('@/components/ui/action-sheet');
    return render(
      createElement(ActionSheet, {
        visible: true,
        title: 'Remove this moment?',
        description: 'This moment will be removed.',
        actions: [
          { label: 'Remove', onPress: vi.fn(), variant: 'destructive' },
          { label: 'Cancel', onPress: vi.fn() },
        ],
        onClose: onCloseSpy,
        ...props,
      } as never)
    );
  }

  it('presents the platform-native sheet when visible', async () => {
    await renderSheet();
    // SwiftUI detents / Compose sheet / vaul drawer, not our hand-rolled one.
    expect(screen.getByTestId('native-sheet')).toBeTruthy();
  });

  it('renders the title, description, and main rows', async () => {
    await renderSheet();
    expect(screen.getByText('Remove this moment?')).toBeTruthy();
    expect(screen.getByText('This moment will be removed.')).toBeTruthy();
    expect(screen.getByLabelText('Remove')).toBeTruthy();
  });

  it('pipes native dismissal back through onClose', async () => {
    await renderSheet();
    fireEvent.click(screen.getByTestId('native-sheet-dismiss'));
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });

  it('splits a trailing non-destructive action into its own cancel row', async () => {
    await renderSheet();
    const cancel = screen.getByLabelText('Cancel');
    // Distinct row below the group (marginTop) rather than inline.
    expect(cancel.style.marginTop).toBe('8px');
  });

  it('runs action handlers', async () => {
    const onRemove = vi.fn();
    const onCancel = vi.fn();
    await renderSheet({
      actions: [
        { label: 'Remove', onPress: onRemove, variant: 'destructive' },
        { label: 'Cancel', onPress: onCancel },
      ],
    });
    fireEvent.click(screen.getByLabelText('Remove'));
    fireEvent.click(screen.getByLabelText('Cancel'));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps both rows grouped when the trailing action is destructive', async () => {
    await renderSheet({
      title: 'This moment',
      actions: [
        { label: 'Edit', onPress: vi.fn() },
        { label: 'Delete', onPress: vi.fn(), variant: 'destructive' },
      ],
    });
    // Edit/Delete share one container — no separate cancel row.
    const edit = screen.getByLabelText('Edit');
    const del = screen.getByLabelText('Delete');
    expect(edit.parentElement).toBe(del.parentElement);
  });

  it('renders nothing when hidden', async () => {
    await renderSheet({ visible: false });
    expect(screen.queryByTestId('native-sheet')).toBeNull();
  });
});

describe('NativeSheet wrapper', () => {
  it('maps visible → present and close, and forwards native dismissal', async () => {
    const { NativeSheet } = await import('@/components/ui/native-sheet');
    const onClose = vi.fn();
    const view = render(
      createElement(NativeSheet, { visible: true, onClose }, createElement('span', {}, 'body'))
    );
    expect(screen.getByTestId('native-sheet')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
    fireEvent.click(screen.getByTestId('native-sheet-dismiss'));
    expect(onClose).toHaveBeenCalledTimes(1);

    view.rerender(createElement(NativeSheet, { visible: false, onClose }, null));
    expect(screen.queryByTestId('native-sheet')).toBeNull();
  });
});

describe('no removed StyleSheet.absoluteFillObject anywhere', () => {
  it('components/ carries no absoluteFillObject usages', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.tsx?$/.test(entry.name)) {
          if (readFileSync(path, 'utf8').includes('absoluteFillObject')) {
            offenders.push(path);
          }
        }
      }
    };
    walk(join(import.meta.dirname, '../../../components'));
    expect(offenders).toEqual([]);
  });
});
