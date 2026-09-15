import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useOnboardingFlow } from '@/components/setup/use-onboarding-flow';

const replaceMock = vi.hoisted(() => vi.fn());

const sessionMock = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'aoi@example.com', displayName: 'Aoi' },
  signOut: vi.fn(async () => {}),
}));

const spaceMock = vi.hoisted(() => ({
  space: null as { id: string } | null,
  createSpace: vi.fn(),
  joinSpace: vi.fn(),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ replace: replaceMock, back: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/features/session/session-context', () => ({
  useSession: () => sessionMock,
}));

vi.mock('@/features/space/space-context', () => ({
  useSpace: () => spaceMock,
}));

const callOrder: string[] = [];

beforeEach(() => {
  callOrder.length = 0;
  replaceMock.mockClear();
  spaceMock.space = null;
  spaceMock.createSpace.mockReset();
  spaceMock.joinSpace.mockReset();
  sessionMock.user = { id: 'user-1', email: 'aoi@example.com', displayName: 'Aoi' };
  spaceMock.createSpace.mockImplementation(async () => {
    callOrder.push('createSpace');
    return { id: 'space-new' };
  });
  spaceMock.joinSpace.mockImplementation(async () => ({ id: 'space-joined' }));
});

describe('onboarding create path (minimum pre-Story state)', () => {
  it('creates the Space with no partner/date/photo/memory questions and enters Story', async () => {
    const { result } = renderHook(() => useOnboardingFlow());

    // Welcome step offers exactly create / join — no setup form.
    expect(result.current.step).toBe('welcome');

    await act(async () => {
      await result.current.submitCreate();
    });

    expect(spaceMock.createSpace).toHaveBeenCalledTimes(1);
    expect(spaceMock.createSpace).toHaveBeenCalledWith({
      name: 'Our space',
      createdByUserId: 'user-1',
      yourName: 'Aoi',
    });
    const sent = spaceMock.createSpace.mock.calls[0][0] as Record<string, unknown>;
    expect('partnerName' in sent).toBe(false);
    expect('relationshipStartDate' in sent).toBe(false);
    expect(replaceMock).toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });

  it('create failure surfaces honestly without routing', async () => {
    spaceMock.createSpace.mockRejectedValue(new Error('Space is full.'));
    const { result } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.submitCreate();
    });

    expect(result.current.error).toBe('Space is full.');
    expect(replaceMock).not.toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });

  it('resumed flow with an existing Space does not create another one', async () => {
    spaceMock.space = { id: 'space-existing' };
    const { result } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.submitCreate();
    });

    expect(spaceMock.createSpace).not.toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });

  it('deduplicates rapid double submit of Space creation', async () => {
    let resolveSpace: ((v: unknown) => void) | null = null;
    spaceMock.createSpace.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSpace = resolve as (v: unknown) => void;
        }),
    );
    const { result } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      const first = result.current.submitCreate();
      const second = result.current.submitCreate();
      (resolveSpace as (v: unknown) => void)({ id: 'space-new' });
      await Promise.all([first, second]);
    });

    expect(spaceMock.createSpace).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  it('failed create retries without duplicating the Space', async () => {
    spaceMock.createSpace
      .mockRejectedValueOnce(new Error('Flaky.'))
      .mockImplementation(async () => {
        callOrder.push('createSpace');
        return { id: 'space-new' };
      });
    const { result } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.submitCreate();
    });
    expect(result.current.error).toBe('Flaky.');
    expect(replaceMock).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.submitCreate();
    });
    expect(spaceMock.createSpace).toHaveBeenCalledTimes(2);
    expect(replaceMock).toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });
});

describe('onboarding join path', () => {
  it('joins with an invite code and lands in Story directly', async () => {
    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      result.current.goJoin();
    });
    await act(async () => {
      result.current.setInviteCode('abc123');
    });

    await act(async () => {
      await result.current.submitJoin();
    });

    expect(spaceMock.joinSpace).toHaveBeenCalledWith({
      userId: 'user-1',
      inviteCode: 'ABC123',
    });
    expect(replaceMock).toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });

  it('invalid codes never reach the server', async () => {
    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      result.current.goJoin();
    });
    await act(async () => {
      result.current.setInviteCode('???');
    });

    await act(async () => {
      await result.current.submitJoin();
    });

    expect(spaceMock.joinSpace).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });

  it('join failure surfaces honestly without routing', async () => {
    spaceMock.joinSpace.mockRejectedValue(new Error('No such code.'));
    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      result.current.goJoin();
    });
    await act(async () => {
      result.current.setInviteCode('ABC123');
    });

    await act(async () => {
      await result.current.submitJoin();
    });

    expect(result.current.error).toBe('No such code.');
    expect(replaceMock).not.toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });
});

describe('onboarding flow surface', () => {
  it('exposes no setup-questionnaire state (partner/date/photo/memory live elsewhere)', async () => {
    const { result } = renderHook(() => useOnboardingFlow());
    const flow = result.current as unknown as Record<string, unknown>;
    for (const removed of [
      'goAbout',
      'yourName',
      'setYourName',
      'partnerName',
      'setPartnerName',
      'startDate',
      'setStartDate',
      'photoUri',
      'pickPhoto',
      'removePhoto',
      'noteBody',
      'setNoteBody',
      'voiceUri',
      'setVoiceUri',
      'canCreate',
      'submitAbout',
      'publishFirstMemory',
      'skipToStory',
    ]) {
      expect(flow[removed], removed).toBeUndefined();
    }
    expect(result.current.step).toBe('welcome');
  });
});
