import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

let mockMoments: any[] = [];
let mockIsLoading = false;
let capturedFormProps: any = null;
const updateMoment = vi.fn();
const backSpy = vi.fn();

vi.mock('@/features/moments/moments-context', () => ({
  useMoments: () => ({
    moments: mockMoments,
    isLoading: mockIsLoading,
    updateMoment,
  }),
}));

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'moment-1' }),
  useRouter: () => ({ back: backSpy, push: vi.fn() }),
}));

// Stand-in for the composer-composition edit form: it receives the stored
// moment and reports values back through onSubmit, so these tests assert
// what saving *does* (update payload + navigation), never that a section,
// string, or element is on screen.
vi.mock('@/components/moments/moment-form', () => ({
  MomentForm: (props: any) => {
    capturedFormProps = props;
    const baseValues = {
      expectedUpdatedAt: props.initialMoment.updatedAt,
      type: props.initialMoment.type,
      title: props.initialMoment.title,
      body: 'Edited body',
      occurredAt: props.initialMoment.occurredAt,
      targetAt: null,
      mediaPreview: null,
      audioUri: null,
      mediaId: null,
    };
    return (
      <div>
        <button onClick={() => props.onSubmit(baseValues)}>mock-save-edit</button>
        <button
          onClick={() =>
            props.onSubmit({ ...baseValues, occurredAt: '2026-03-20T10:00:00.000Z' })
          }
        >
          mock-save-new-date
        </button>
      </div>
    );
  },
}));

vi.mock('@/components/themed-text', () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/components/ui/surface', () => ({
  Surface: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ label }: any) => <button>{label}</button>,
}));

vi.mock('@/hooks/use-theme-color', () => ({
  useThemeColor: () => '#000000',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

function makeMoment(overrides: Record<string, any> = {}) {
  return {
    id: 'moment-1',
    type: 'note' as const,
    title: 'Test moment',
    body: 'Test body',
    occurredAt: '2026-03-15T10:00:00.000Z',
    targetAt: null,
    createdAt: '2026-03-15T10:00:00.000Z',
    updatedAt: '2026-03-15T10:00:00.000Z',
    authorId: 'user_you',
    authorRole: 'you' as const,
    authorName: 'You',
    ...overrides,
  };
}

describe('EditMomentScreen ownership gate', () => {
  beforeEach(() => {
    mockMoments = [];
    mockIsLoading = false;
    capturedFormProps = null;
    updateMoment.mockReset();
    updateMoment.mockResolvedValue(undefined);
    backSpy.mockClear();
  });

  it('saving an own moment sends the stored type, title, body, and date to updateMoment and goes back', async () => {
    // A non-default stored type proves the edit path infers/locks the
    // existing type instead of re-asking: it must flow through unchanged.
    mockMoments = [makeMoment({ isOwn: true, type: 'milestone', title: 'Original title' })];
    const { default: EditMomentScreen } = await import('@/app/(app)/moment/edit/[id]');
    render(<EditMomentScreen />);
    await act(async () => {
      fireEvent.click(screen.getByText('mock-save-edit'));
    });
    expect(updateMoment).toHaveBeenCalledTimes(1);
    expect(updateMoment).toHaveBeenCalledWith(
      'moment-1',
      expect.objectContaining({
        type: 'milestone',
        title: 'Original title',
        body: 'Edited body',
        occurredAt: '2026-03-15T10:00:00.000Z',
        expectedUpdatedAt: '2026-03-15T10:00:00.000Z',
      }),
    );
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('forwards the form version after a background refresh and does not navigate on conflict', async () => {
    const original = makeMoment({ isOwn: true });
    mockMoments = [original];
    const { default: EditMomentScreen } = await import('@/app/(app)/moment/edit/[id]');
    const view = render(<EditMomentScreen />);
    mockMoments = [{ ...original, updatedAt: '2026-03-16T10:00:00.000Z', body: 'Remote change' }];
    view.rerender(<EditMomentScreen />);
    const message = 'This memory changed on another device. Reopen it before trying again.';
    updateMoment.mockRejectedValueOnce(new Error(message));
    await act(async () => {
      await expect(capturedFormProps.onSubmit({
        ...original, body: 'Typed draft', expectedUpdatedAt: original.updatedAt,
      })).rejects.toThrow(message);
    });
    expect(updateMoment).toHaveBeenCalledTimes(1);
    expect(updateMoment).toHaveBeenCalledWith(original.id, expect.objectContaining({
      expectedUpdatedAt: original.updatedAt, body: 'Typed draft',
    }));
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('preserves the opened editor when a conflict refresh removes the resident memory', async () => {
    const original = makeMoment({ isOwn: true });
    mockMoments = [original];
    const { default: EditMomentScreen } = await import('@/app/(app)/moment/edit/[id]');
    const view = render(<EditMomentScreen />);
    mockMoments = [];
    view.rerender(<EditMomentScreen />);
    expect(capturedFormProps.initialMoment).toBe(original);
    const conflict = Object.assign(new Error('Changed on another device'), { status: 409 });
    updateMoment.mockRejectedValueOnce(conflict);
    await act(async () => {
      await expect(capturedFormProps.onSubmit({
        expectedUpdatedAt: original.updatedAt,
        type: original.type, title: original.title, body: 'My unsaved words',
        occurredAt: original.occurredAt, targetAt: null, mediaPreview: null, audioUri: null, mediaId: null,
      })).rejects.toBe(conflict);
    });
    expect(backSpy).not.toHaveBeenCalled();
    expect(updateMoment).toHaveBeenCalledWith(original.id, expect.objectContaining({
      body: 'My unsaved words', expectedUpdatedAt: original.updatedAt,
    }));
  });

  it('commits through the Keep verb', async () => {
    mockMoments = [makeMoment({ isOwn: true })];
    const { default: EditMomentScreen } = await import('@/app/(app)/moment/edit/[id]');
    render(<EditMomentScreen />);
    expect(capturedFormProps.submitLabel).toBe('Keep changes');
  });

  it('an edited date reaches updateMoment as occurredAt', async () => {
    mockMoments = [makeMoment({ isOwn: true })];
    const { default: EditMomentScreen } = await import('@/app/(app)/moment/edit/[id]');
    render(<EditMomentScreen />);
    await act(async () => {
      fireEvent.click(screen.getByText('mock-save-new-date'));
    });
    expect(updateMoment).toHaveBeenCalledTimes(1);
    expect(updateMoment).toHaveBeenCalledWith(
      'moment-1',
      expect.objectContaining({ occurredAt: '2026-03-20T10:00:00.000Z' }),
    );
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('blocks editing a partner moment even when authorRole claims "you"', async () => {
    // Regression: the remote API once hardcoded authorRole "you" for every
    // moment, so the old authorRole gate offered Edit on partner moments.
    mockMoments = [
      makeMoment({
        authorRole: 'you',
        authorName: 'Alex',
        isOwn: false,
      }),
    ];
    const { default: EditMomentScreen } = await import('@/app/(app)/moment/edit/[id]');
    render(<EditMomentScreen />);
    expect(screen.queryByText('mock-save-edit')).toBeNull();
    expect(screen.getByText(/can edit this/)).toBeTruthy();
    expect(updateMoment).not.toHaveBeenCalled();
  });

  it('blocks editing when ownership is unknown (missing isOwn)', async () => {
    mockMoments = [makeMoment({ authorRole: 'you' })];
    const { default: EditMomentScreen } = await import('@/app/(app)/moment/edit/[id]');
    render(<EditMomentScreen />);
    expect(screen.queryByText('mock-save-edit')).toBeNull();
    expect(screen.getByText(/can edit this/)).toBeTruthy();
    expect(updateMoment).not.toHaveBeenCalled();
  });

  it('shows a loading state while moments are still loading', async () => {
    mockMoments = [];
    mockIsLoading = true;
    const { default: EditMomentScreen } = await import('@/app/(app)/moment/edit/[id]');
    render(<EditMomentScreen />);
    expect(screen.getByText(/Loading moment/)).toBeTruthy();
  });

  it('shows a missing state, distinct from loading, when the moment is gone', async () => {
    mockMoments = [];
    mockIsLoading = false;
    const { default: EditMomentScreen } = await import('@/app/(app)/moment/edit/[id]');
    render(<EditMomentScreen />);
    expect(screen.getByText(/no longer available/)).toBeTruthy();
    expect(screen.queryByText('mock-save-edit')).toBeNull();
    expect(updateMoment).not.toHaveBeenCalled();
  });
});
