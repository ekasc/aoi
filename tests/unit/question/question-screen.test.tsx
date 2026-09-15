import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createElement } from 'react';

// Deferred mock state: read when hooks run (same pattern as space-hub.test).
let mockQuestion: any = null;
let mockSpace: any = null;
let scrollProps: any = null;

vi.mock('react-native', () => {
  function flattenStyle(style: unknown): unknown {
    if (Array.isArray(style)) {
      const merged: Record<string, unknown> = {};
      for (const entry of style) {
        const flat = flattenStyle(entry) as Record<string, unknown>;
        if (flat && typeof flat === 'object') Object.assign(merged, flat);
      }
      return merged;
    }
    return style;
  }

  function withAriaProps(props: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = { ...props };
    if (typeof props.accessibilityLabel === 'string') {
      next['aria-label'] = props.accessibilityLabel;
    }
    if (typeof props.onPress === 'function') {
      next.onClick = props.onPress;
    }
    return next;
  }

  function div(children: unknown, style: unknown, props: Record<string, unknown>) {
    return createElement(
      'div',
      { style: flattenStyle(style), ...withAriaProps(props) },
      children
    );
  }

  const View = (props: any) => {
    const { children, style, ...rest } = props;
    return div(children, style, rest);
  };

  const Text = (props: any) => {
    const { children, style, ...rest } = props;
    return createElement(
      'span',
      { style: flattenStyle(style), ...withAriaProps(rest) },
      children
    );
  };

  const Pressable = (props: any) => {
    const { children, style, ...rest } = props;
    const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
    return div(children, resolved, rest);
  };

  const TextInput = (props: any) => {
    const {
      style,
      value,
      onChangeText,
      placeholder,
      maxLength,
      ...rest
    } = props;
    // multiline / textAlignVertical / placeholderTextColor are RN-only.
    delete rest.multiline;
    delete rest.textAlignVertical;
    delete rest.placeholderTextColor;
    return createElement('input', {
      style: flattenStyle(style),
      value: value ?? '',
      placeholder,
      maxLength,
      ...withAriaProps(rest),
      onChange: (event: any) => onChangeText?.(event.target.value),
    });
  };

  const ScrollView = (props: any) => {
    const { children, style, contentContainerStyle, ...rest } = props;
    scrollProps = props;
    return createElement(
      'div',
      {
        'data-testid': 'question-scroll',
        style: flattenStyle(contentContainerStyle ?? style),
        ...withAriaProps(rest),
      },
      children
    );
  };

  const KeyboardAvoidingView = (props: any) => {
    const { children, style, behavior, ...rest } = props;
    return div(children, style, rest);
  };

  const ActivityIndicator = () =>
    createElement('div', { 'data-testid': 'spinner' });

  return {
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
      hairlineWidth: 1,
      flatten: flattenStyle,
    },
    View,
    Text,
    Pressable,
    TextInput,
    ScrollView,
    KeyboardAvoidingView,
    ActivityIndicator,
    Platform: { OS: 'ios', select: (options: any) => options.ios },
  };
});

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: (_overrides: unknown, name?: string) =>
    name === 'warning' ? '#8a5f2b' : '#3a3a3a',
}));

vi.mock('@/features/question/question-context', () => ({
  useQuestion: () => mockQuestion,
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => ({ space: mockSpace }),
}));

// Style-preserving Surface stand-in: keeps borderRadius/padding assertions
// honest without pulling in the native glass view.
vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children, style }: any) => {
    const flat = Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean))
      : style;
    return createElement('div', { 'data-surface': 'true', style: flat }, children);
  },
}));

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    weekKey: '2026-W32',
    questionId: 4,
    question: 'What made you laugh together this week?',
    yourAnswer: null,
    yourAnswerUpdatedAt: null,
    partnerAnswered: false,
    partnerAnswer: null,
    partnerName: 'Mara',
    revealed: false,
    ...overrides,
  };
}

async function renderQuestion() {
  const { default: QuestionScreen } = await import('@/app/(app)/question');
  return render(createElement(QuestionScreen));
}

function hitTargetFor(label: string): HTMLElement {
  const labelNode = screen.getByText(label);
  const hit = labelNode.closest('div');
  if (!hit) throw new Error(`no hit target for ${label}`);
  return hit as HTMLElement;
}

beforeEach(() => {
  mockSpace = { partnerName: 'Mara' };
  scrollProps = null;
  mockQuestion = {
    state: baseState(),
    isLoading: false,
    error: null,
    isSaving: false,
    submitAnswer: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
  };
});

describe('QuestionScreen loading and error (network behavior preserved)', () => {
  it('shows a spinner while the week is loading', async () => {
    mockQuestion = { ...mockQuestion, state: null, isLoading: true };
    await renderQuestion();

    expect(screen.getByTestId('spinner')).toBeTruthy();
    expect(screen.queryByLabelText('Your reflection answer')).toBeNull();
  });

  it('shows the gentle error with a retry that reloads', async () => {
    mockQuestion = {
      ...mockQuestion,
      state: null,
      error: "This week's question could not be loaded right now.",
    };
    await renderQuestion();

    expect(
      screen.getByText("This week's question could not be loaded right now.")
    ).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    expect(mockQuestion.reload).toHaveBeenCalledTimes(1);
  });
});

describe('QuestionScreen composer (answer behavior preserved)', () => {
  it('leads with the serif question and blocks an empty save', async () => {
    await renderQuestion();

    expect(
      screen.getByText('What made you laugh together this week?')
    ).toBeTruthy();
    const input = screen.getByLabelText('Your reflection answer') as HTMLInputElement;
    expect(input.placeholder).toBe('Something small and true…');

    fireEvent.click(screen.getByText('Keep my answer'));
    expect(mockQuestion.submitAnswer).not.toHaveBeenCalled();
  });

  it('trims the draft before submitting', async () => {
    await renderQuestion();

    fireEvent.change(screen.getByLabelText('Your reflection answer'), {
      target: { value: '  Something small and true.  ' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Keep my answer'));
    });

    expect(mockQuestion.submitAnswer).toHaveBeenCalledTimes(1);
    expect(mockQuestion.submitAnswer).toHaveBeenCalledWith(
      'Something small and true.'
    );
  });

  it('keeps the draft and reassures when saving fails', async () => {
    mockQuestion.submitAnswer = vi.fn(async () => {
      throw new Error('network down');
    });
    await renderQuestion();

    fireEvent.change(screen.getByLabelText('Your reflection answer'), {
      target: { value: 'Something small and true.' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Keep my answer'));
    });

    expect(
      await screen.findByText(
        "Your answer couldn't be saved right now, try again in a moment."
      )
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('Your reflection answer') as HTMLInputElement).value
    ).toBe('Something small and true.');
  });

  it('keeps the partner answer hidden until both have written (privacy)', async () => {
    mockQuestion.state = baseState({
      yourAnswer: 'The way they made coffee on Tuesday.',
      yourAnswerUpdatedAt: '2026-08-01T10:00:00.000Z',
      partnerAnswered: true,
      partnerAnswer: null,
    });
    await renderQuestion();

    expect(
      screen.getByText('Saved. It unlocks when Mara has written too.')
    ).toBeTruthy();
    // Update path, not first-save path.
    expect(screen.getByText('Update my answer')).toBeTruthy();
  });

  it('pairs the saved-but-locked note with one gold dot in warning', async () => {
    mockQuestion.state = baseState({
      yourAnswer: 'The way they made coffee on Tuesday.',
      yourAnswerUpdatedAt: '2026-08-01T10:00:00.000Z',
      partnerAnswered: true,
      partnerAnswer: null,
    });
    const { container } = await renderQuestion();

    const note = screen.getByText('Saved. It unlocks when Mara has written too.');
    expect((note as HTMLElement).style.color).toBe('#8a5f2b');
    const dots = Array.from(container.querySelectorAll('div')).filter(
      (element) =>
        (element as HTMLElement).style.backgroundColor === '#8a5f2b' &&
        (element as HTMLElement).style.width === '8px' &&
        (element as HTMLElement).style.height === '8px'
    );
    expect(dots).toHaveLength(1);
  });
});

describe('QuestionScreen reveal (unlock behavior preserved)', () => {
  it('reveals both answers and returns to the composer to edit', async () => {
    mockQuestion.state = baseState({
      yourAnswer: 'The way they made coffee on Tuesday.',
      partnerAnswered: true,
      partnerAnswer: 'Their quiet answer.',
      revealed: true,
    });
    await renderQuestion();

    expect(screen.getByText('The way they made coffee on Tuesday.')).toBeTruthy();
    expect(screen.getByText('Their quiet answer.')).toBeTruthy();
    expect(screen.getByText('Mara')).toBeTruthy();
    // Composer is parked while revealed.
    expect(screen.queryByLabelText('Your reflection answer')).toBeNull();

    fireEvent.click(screen.getByText('Edit my answer'));

    const input = (await screen.findByLabelText(
      'Your reflection answer'
    )) as HTMLInputElement;
    expect(input.value).toBe('The way they made coffee on Tuesday.');
  });
});

describe('QuestionScreen softer layout constraints', () => {
  it('scrolls the week (320px and enlarged text never clip)', async () => {
    await renderQuestion();

    expect(screen.getByTestId('question-scroll')).toBeTruthy();
    expect(scrollProps.keyboardShouldPersistTaps).toBe('handled');
  });

  it('keeps 44px targets with a rounded compose area', async () => {
    await renderQuestion();

    expect(hitTargetFor('Keep my answer').style.minHeight).toBe('44px');
    const input = screen.getByLabelText('Your reflection answer') as HTMLElement;
    expect(input.style.minHeight).toBe('112px');
    const composer = input.closest('[data-surface]') as HTMLElement;
    expect(composer.style.borderRadius).toBe('16px');
  });

  it('groups revealed answers softly with a compact 44px edit action', async () => {
    mockQuestion.state = baseState({
      yourAnswer: 'The way they made coffee on Tuesday.',
      partnerAnswered: true,
      partnerAnswer: 'Their quiet answer.',
      revealed: true,
    });
    await renderQuestion();

    const cards = document.querySelectorAll('[data-surface]');
    expect(cards.length).toBe(2);
    for (const card of cards) {
      expect((card as HTMLElement).style.borderRadius).toBe('16px');
    }
    expect(hitTargetFor('Edit my answer').style.minHeight).toBe('44px');
  });

  it('adds no scores, progress, or dashboard chrome', async () => {
    await renderQuestion();

    expect(screen.queryByText(/score|streak|progress|dashboard|rainbow/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /score|streak|progress|dashboard|rainbow|illustration|trophy|chart/i
    );
  });
});
