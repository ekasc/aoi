import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    ScrollView: View,
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

vi.mock('@/components/forms/native-date-time-field', () => ({
  NativeDateTimeField: ({
    accessibilityLabel,
    onChange,
  }: {
    accessibilityLabel: string;
    onChange: (date: Date) => void;
  }) =>
    createElement(
      'button',
      {
        'aria-label': accessibilityLabel,
        onClick: () => onChange(new Date(2024, 6, 8, 12)),
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
});

describe('Edit relationship screen', () => {
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

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose relationship start date' }));
    });
    await saveWithName('Dated space');

    expect(spaceMock.updateSpace).toHaveBeenCalledWith({
      name: 'Dated space',
      partnerName: 'June',
      relationshipStartDate: '2024-07-08',
    });
  });
});
