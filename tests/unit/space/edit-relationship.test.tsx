import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spaceMock = vi.hoisted(() => ({
  space: {
    id: 'space-1',
    name: 'Our space',
    createdByUserId: 'user-1',
    yourName: 'Maya',
    partnerName: 'June',
    relationshipStartDate: null as string | null,
    inviteCode: 'invite-1',
    partnerJoined: true,
    inviteExpiresAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  updateSpace: vi.fn(async () => null),
}));

const backSpy = vi.fn();
const scrollProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const keyboardMock = vi.hoisted(() => ({
  visible: false,
  didHide: () => {},
  dismiss: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: backSpy }),
}));

vi.mock('react-native', () => {
  function flattenStyle(style: unknown): unknown {
    if (!Array.isArray(style)) return style;
    const merged: Record<string, unknown> = {};
    for (const entry of style) {
      const flat = flattenStyle(entry);
      if (flat && typeof flat === 'object') Object.assign(merged, flat);
    }
    return merged;
  }

  function withAriaProps(props: Record<string, unknown>) {
    return {
      ...props,
      ...(typeof props.accessibilityLabel === 'string'
        ? { 'aria-label': props.accessibilityLabel }
        : {}),
      ...(typeof props.onPress === 'function' ? { onClick: props.onPress } : {}),
    };
  }

  const View = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createElement('div', { style: flattenStyle(style), ...withAriaProps(rest) }, children);
  };
  const Text = (props: Record<string, unknown>) => {
    const { children, style, ...rest } = props;
    return createElement('span', { style: flattenStyle(style), ...withAriaProps(rest) }, children);
  };
  const TextInput = (props: Record<string, unknown>) => {
    const { value, onChangeText, style, ...rest } = props;
    return createElement('input', {
      value: typeof value === 'string' ? value : '',
      style: flattenStyle(style),
      onChange: (event: { target: { value: string } }) => {
        if (typeof onChangeText === 'function') onChangeText(event.target.value);
      },
      ...withAriaProps(rest),
    });
  };

  return {
    StyleSheet: { create: (styles: Record<string, unknown>) => styles, hairlineWidth: 1 },
    View,
    Text,
    TextInput,
    Keyboard: {
      dismiss: keyboardMock.dismiss,
      isVisible: () => keyboardMock.visible,
      addListener: (_event: string, listener: () => void) => {
        keyboardMock.didHide = listener;
        return { remove: keyboardMock.remove };
      },
    },
    Pressable: (props: Record<string, unknown>) => {
      const { children, accessibilityLabel, accessibilityState, onPress, disabled } = props;
      const expanded = accessibilityState && typeof accessibilityState === 'object' && 'expanded' in accessibilityState
        ? accessibilityState.expanded : undefined;
      return createElement('button', { 'aria-label': accessibilityLabel, 'aria-expanded': expanded, onClick: onPress, disabled }, children);
    },
    ScrollView: (props: Record<string, unknown>) => {
      scrollProps.current = props;
      const { testID, ...rest } = props;
      return View({ ...rest, 'data-testid': testID });
    },
    KeyboardAvoidingView: View,
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => spaceMock,
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: { children?: unknown }) => createElement('span', {}, children),
}));

vi.mock('@/components/ui/divider', () => ({
  Divider: () => createElement('hr'),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label, onPress }: { label: string; onPress?: () => void }) =>
    createElement('button', { onClick: onPress }, label),
}));

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

vi.mock('@/components/ui/native-sheet', () => ({
  NativeSheet: ({ visible, children, onClose }: { visible: boolean; children: React.ReactNode; onClose: () => void }) =>
    visible ? createElement('div', { role: 'dialog', 'aria-label': 'Date picker' }, children,
      createElement('button', { onClick: onClose }, 'Dismiss date picker')) : null,
}));

vi.mock('@react-native-community/datetimepicker', () => ({
  default: ({
    onChange,
  }: {
    onChange: (event: { type: string }, date: Date) => void;
  }) =>
    createElement(
      'button',
      {
        'aria-label': 'Select date',
        onClick: () => onChange({ type: 'set' }, new Date(2024, 6, 8, 12)),
      },
      'Choose date',
    ),
}));

async function renderScreen() {
  const { default: EditRelationshipScreen } = await import(
    '@/app/(app)/profile/edit-relationship'
  );
  return render(<EditRelationshipScreen />);
}

async function saveWithName(name: string) {
  fireEvent.change(screen.getByLabelText('Space name'), { target: { value: name } });
  await act(async () => {
    fireEvent.click(screen.getByText('Save changes'));
  });
}

beforeEach(() => {
  spaceMock.space.name = 'Our space';
  spaceMock.space.partnerName = 'June';
  spaceMock.space.relationshipStartDate = null;
  spaceMock.updateSpace.mockReset();
  spaceMock.updateSpace.mockResolvedValue(null);
  backSpy.mockReset();
  keyboardMock.visible = false;
  keyboardMock.dismiss.mockClear();
  vi.stubEnv('EXPO_OS', 'ios');
});

afterEach(() => vi.unstubAllEnvs());

describe('Edit relationship screen', () => {
  it('gives the native form sheet a root scroll view containing both inputs and actions, with keyboard inset handling', async () => {
    const tree = await renderScreen();
    const form = screen.getByTestId('relationship-form');
    expect(tree.container.firstElementChild).toBe(form);
    expect(form.contains(screen.getByLabelText('Space name'))).toBe(true);
    expect(form.contains(screen.getByLabelText('Partner name'))).toBe(true);
    expect(form.contains(screen.getByText('Save changes'))).toBe(true);
    expect(scrollProps.current.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(scrollProps.current.contentInsetAdjustmentBehavior).toBe('automatic');
  });
  it('shows the missing date action and omits relationshipStartDate when saving', async () => {
    await renderScreen();

    expect(screen.getByText('Add relationship start date')).toBeTruthy();
    await saveWithName('Updated space');

    expect(spaceMock.updateSpace).toHaveBeenCalledWith({
      name: 'Updated space',
      partnerName: 'June',
    });
  });

  it('omits an unchanged legacy ISO date when saving', async () => {
    spaceMock.space.relationshipStartDate = '2021-03-04T00:00:00.000Z';
    await renderScreen();

    await saveWithName('Renamed space');

    expect(spaceMock.updateSpace).toHaveBeenCalledWith({
      name: 'Renamed space',
      partnerName: 'June',
    });
  });

  it('submits a selected date as YYYY-MM-DD', async () => {
    spaceMock.space.relationshipStartDate = '2021-03-04T00:00:00.000Z';
    await renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Choose relationship start date' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select date' }));
    });
    await saveWithName('Dated space');

    expect(spaceMock.updateSpace).toHaveBeenCalledWith({
      name: 'Dated space',
      partnerName: 'June',
      relationshipStartDate: '2024-07-08',
    });
  });

  it('opens and closes the separate iOS picker without saving or clearing the relationship form', async () => {
    spaceMock.space.relationshipStartDate = '2021-03-04';
    await renderScreen();
    const toggle = screen.getByRole('button', { name: 'Choose relationship start date' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Date picker' }).contains(screen.getByRole('button', { name: 'Select date' }))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Select date' })).toBeNull();
    expect(spaceMock.updateSpace).not.toHaveBeenCalled();
  });

  it('waits for the keyboard to finish dismissing before presenting the date sheet', async () => {
    spaceMock.space.relationshipStartDate = '2021-03-04';
    keyboardMock.visible = true;
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Choose relationship start date' }));
    expect(keyboardMock.dismiss).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => keyboardMock.didHide());
    expect(screen.getByRole('dialog', { name: 'Date picker' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss date picker' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Space name')).toHaveProperty('value', 'Our space');
    expect(spaceMock.updateSpace).not.toHaveBeenCalled();
  });
});
