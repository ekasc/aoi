import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ItemForm, type ItemFormValues } from '@/components/collections/item-form';

// Exercise the iOS adapter's native event wiring. These stand-ins do not
// establish SwiftUI layout, keyboard behavior, or VoiceOver support.
vi.mock('@/components/ui/expo-controls', async () => import('@/components/ui/expo-controls.ios'));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: vi.fn() }));
vi.mock('@/hooks/use-theme-color', () => ({ useThemeColor: () => '#000000' }));

type Modifier = { type: string; value: unknown };
const modifierValue = (modifiers: Modifier[], type: string) => modifiers.find((modifier) => modifier.type === type)?.value;

vi.mock('@expo/ui/swift-ui/modifiers', () => {
  const modifier = (type: string) => (value: unknown) => ({ type, value });
  return Object.fromEntries(['accessibilityHint', 'accessibilityLabel', 'background', 'buttonStyle', 'cornerRadius', 'font', 'foregroundColor', 'padding', 'tint', 'disabled', 'frame', 'textFieldStyle', 'textInputAutocapitalization'].map((type) => [type, modifier(type)]));
});

vi.mock('@expo/ui/swift-ui', () => {
  const TextField = ({ text, onTextChange, modifiers, maxLength }: { text: { value: string }; onTextChange: (value: string) => void; modifiers: Modifier[]; maxLength: number }) => {
    const [value, setValue] = useState(text.value);
    return <input aria-label={String(modifierValue(modifiers, 'accessibilityLabel'))} disabled={Boolean(modifierValue(modifiers, 'disabled'))} maxLength={maxLength} value={value} onChange={(event) => {
      text.value = event.currentTarget.value;
      setValue(text.value);
      onTextChange(text.value);
    }} />;
  };
  TextField.Placeholder = function Placeholder() { return null; };
  return {
    useNativeState: (value: string) => useState(() => ({ value }))[0],
    Host: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    VStack: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Section: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    TextField,
    Button: ({ label, children, onPress, modifiers = [] }: { label?: string; children?: ReactNode; onPress: () => void; modifiers?: Modifier[] }) => (
      <button aria-label={String(modifierValue(modifiers, 'accessibilityLabel') ?? label)} disabled={Boolean(modifierValue(modifiers, 'disabled'))} onClick={onPress}>{label ?? children}</button>
    ),
    Menu: ({ children, modifiers }: { children: ReactNode; modifiers: Modifier[] }) => <fieldset disabled={Boolean(modifierValue(modifiers, 'disabled'))}>{children}</fieldset>,
    Toggle: ({ label, onIsOnChange, modifiers }: { label: string; onIsOnChange: () => void; modifiers: Modifier[] }) => <button aria-label={label} disabled={Boolean(modifierValue(modifiers, 'disabled'))} onClick={onIsOnChange}>{label}</button>,
  };
});

const initial: ItemFormValues = { title: 'Perfect Days', note: null, link: null, coverUrl: null, status: 'done', score: 9 };

function form(onSubmit: (values: ItemFormValues) => Promise<void>) {
  return render(<ItemForm initial={initial} submitLabel="Save" onSubmit={onSubmit} a11yPrefix="Edit " />);
}

describe('Expo UI item form event contract', () => {
  it('saves native field changes and explicitly cleared choices', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    form(submit);
    fireEvent.change(screen.getByLabelText('Edit title'), { target: { value: ' Perfect Days again ' } });
    fireEvent.change(screen.getByLabelText('Edit note'), { target: { value: ' quiet ' } });
    fireEvent.click(screen.getByLabelText('No status'));
    fireEvent.click(screen.getByLabelText('Unrated'));
    fireEvent.click(screen.getByLabelText('Save'));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ ...initial, title: 'Perfect Days again', note: 'quiet', status: null, score: null }));
  });

  it('keeps the native draft after failure and retries it', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    form(submit);
    fireEvent.change(screen.getByLabelText('Edit title'), { target: { value: 'My draft' } });
    fireEvent.click(screen.getByLabelText('Save'));
    await screen.findByText("Couldn't save this thing. Your draft is still here.");
    expect((screen.getByLabelText('Edit title') as HTMLInputElement).value).toBe('My draft');
    fireEvent.click(screen.getByLabelText('Save'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit).toHaveBeenLastCalledWith({ ...initial, title: 'My draft' });
  });

  it('prevents further edits and submissions while a write is pending', () => {
    const submit = vi.fn(() => new Promise<void>(() => {}));
    form(submit);
    fireEvent.click(screen.getByLabelText('Save'));
    expect((screen.getByLabelText('Edit title') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByLabelText('Doing').closest('fieldset')?.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Saving…'));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(initial);
  });
});
