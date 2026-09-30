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
    return { id: 'space-new', inviteCode: 'MINTED1' };
  });
  spaceMock.joinSpace.mockImplementation(async () => ({
    id: 'space-joined',
    partnerName: 'June',
  }));
});

/** What is sitting on the stubbed pasteboard. */
function setClipboard(value: string) {
  (globalThis as unknown as Record<string, unknown>).__aoiClipboard = value;
}

describe('onboarding create path (minimum pre-Story state)', () => {
  it('asks who the space is for, then creates it and holds on the minted code', async () => {
    const { result } = renderHook(() => useOnboardingFlow());

    // The fork offers exactly create / join. Create opens the title page rather
    // than creating straight away: the space has to carry the pair's identity,
    // so the identity is collected before the space exists.
    expect(result.current.step).toBe('welcome');

    await act(async () => {
      result.current.goIdentity();
    });
    expect(result.current.step).toBe('identity');
    expect(spaceMock.createSpace).not.toHaveBeenCalled();

    await act(async () => {
      result.current.setPartnerNameDraft('June');
      result.current.setStartDate(new Date(2023, 4, 12));
    });

    await act(async () => {
      await result.current.submitCreate();
    });

    expect(spaceMock.createSpace).toHaveBeenCalledTimes(1);
    // Named for the pair, which is how the app already refers to one, and
    // carrying what the title page asked for.
    expect(spaceMock.createSpace).toHaveBeenCalledWith({
      name: 'Aoi & June',
      createdByUserId: 'user-1',
      yourName: 'Aoi',
      partnerName: 'June',
      relationshipStartDate: '2023-05-12',
    });
    // No photo was chosen, so none is sent: absence is preserved rather than
    // filled in.
    const sent = spaceMock.createSpace.mock.calls[0][0] as Record<string, unknown>;
    expect('photoUri' in sent).toBe(false);
    // Creating mints the one thing that has to leave the device, so the flow
    // stops on it rather than dropping the reader into Story unseen.
    expect(result.current.step).toBe('minted');
    expect(result.current.mintedCode).toBe('MINTED1');
    expect(replaceMock).not.toHaveBeenCalled();

    await act(async () => {
      result.current.enterStory();
    });
    expect(replaceMock).toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });

  it('create failure surfaces honestly, keeps the choice, and routes nothing', async () => {
    spaceMock.createSpace.mockRejectedValue(new Error('Space is full.'));
    const { result } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.submitCreate();
    });

    expect(result.current.error).toBe('Space is full.');
    // The choice is still the reader's to make: a failed create must not
    // leave them on a beat for a space that does not exist.
    expect(result.current.step).toBe('welcome');
    expect(result.current.mintedCode).toBe('');
    expect(replaceMock).not.toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });

  it('resumed flow with an existing Space does not create another one', async () => {
    spaceMock.space = { id: 'space-existing' };
    const { result } = renderHook(() => useOnboardingFlow());

    expect(result.current.skipToStory).toBe(true);

    await act(async () => {
      await result.current.submitCreate();
    });

    expect(spaceMock.createSpace).not.toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });

  it('a Space minted here is never skipped past before its code is read', async () => {
    let resolveSpace: ((v: unknown) => void) | null = null;
    spaceMock.createSpace.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSpace = resolve as (v: unknown) => void;
        }),
    );
    const { result, rerender } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      void result.current.submitCreate();
    });
    // The provider publishes the new Space the moment the write lands, which
    // is exactly the window that would otherwise redirect out of the beat.
    spaceMock.space = { id: 'space-new' };
    rerender();
    expect(result.current.skipToStory).toBe(false);

    await act(async () => {
      (resolveSpace as (v: unknown) => void)({ id: 'space-new', inviteCode: 'MINTED1' });
    });
    expect(result.current.step).toBe('minted');
    expect(result.current.skipToStory).toBe(false);
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
      (resolveSpace as (v: unknown) => void)({ id: 'space-new', inviteCode: 'MINTED1' });
      await Promise.all([first, second]);
    });

    expect(spaceMock.createSpace).toHaveBeenCalledTimes(1);
    // One space, one code, one beat.
    expect(result.current.step).toBe('minted');
    expect(result.current.mintedCode).toBe('MINTED1');
  });

  it('failed create retries without duplicating the Space', async () => {
    spaceMock.createSpace
      .mockRejectedValueOnce(new Error('Flaky.'))
      .mockImplementation(async () => {
        callOrder.push('createSpace');
        return { id: 'space-new', inviteCode: 'MINTED1' };
      });
    const { result } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.submitCreate();
    });
    expect(result.current.error).toBe('Flaky.');
    expect(result.current.step).toBe('welcome');

    await act(async () => {
      await result.current.submitCreate();
    });
    expect(spaceMock.createSpace).toHaveBeenCalledTimes(2);
    expect(result.current.step).toBe('minted');
    expect(result.current.mintedCode).toBe('MINTED1');
  });
});

describe('onboarding join path', () => {
  it('joins with an invite code and is told who they joined before entering', async () => {
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
      yourName: 'Aoi',
    });
    // Proof before keys: the joiner sees whose space this is, then leaves.
    expect(result.current.step).toBe('joined');
    expect(result.current.partnerName).toBe('June');
    expect(replaceMock).not.toHaveBeenCalled();

    await act(async () => {
      result.current.enterStory();
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

  it('fills the code field from the clipboard, on a tap', async () => {
    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      result.current.goJoin();
    });

    // The stub clipboard holds a whole message, the way one actually arrives.
    await act(async () => {
      setClipboard('join me on aoi, code HQABD7');
      const ok = await result.current.pasteCode();
      expect(ok).toBe(true);
    });
    expect(result.current.inviteCode).toBe('HQABD7');
    expect(result.current.canJoin).toBe(true);
  });

  it('says so, rather than guessing, when the clipboard holds no code', async () => {
    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      result.current.goJoin();
    });

    await act(async () => {
      setClipboard('hey, how are you?');
      const ok = await result.current.pasteCode();
      expect(ok).toBe(false);
    });
    expect(result.current.inviteCode).toBe('');
    expect(result.current.canJoin).toBe(false);
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
    // A failed join must not leave anyone on a beat for a space they are not
    // in, and must not name a partner they do not have.
    expect(result.current.step).toBe('join');
    expect(result.current.partnerName).toBe('');
    expect(replaceMock).not.toHaveBeenCalledWith('/(app)/(tabs)/(memories)');
  });
});

describe('onboarding flow surface', () => {
  it('exposes the title page it asks for, and nothing beyond it', async () => {
    const { result } = renderHook(() => useOnboardingFlow());
    const flow = result.current as unknown as Record<string, unknown>;

    // The title page is real state on the flow now. The pair, the date and the
    // cover are what the space is made of: the sky's calendar, the days
    // together count and the keepsake's cover all read from them, so they are
    // asked for before the space exists rather than left for later.
    for (const present of [
      'goIdentity',
      'partnerNameDraft',
      'setPartnerNameDraft',
      'startDate',
      'setStartDate',
      'photoUri',
      'setPhotoUri',
    ]) {
      expect(flow[present], present).toBeDefined();
    }

    // What is still not here: a second questionnaire, a memory, a note, a voice
    // memo, and a "your name" field, because the account already knows it.
    for (const absent of [
      'goAbout',
      'yourName',
      'setYourName',
      'setPartnerName',
      'pickPhoto',
      'removePhoto',
      'noteBody',
      'setNoteBody',
      'voiceUri',
      'setVoiceUri',
      'canCreate',
      'submitAbout',
      'publishFirstMemory',
    ]) {
      expect(flow[absent], absent).toBeUndefined();
    }

    expect(result.current.step).toBe('welcome');
    expect(result.current.skipToStory).toBe(false);
    expect(result.current.partnerName).toBe('');
    // The date defaults to today rather than to null, because a null date is a
    // sky with no calendar. It is on screen and one tap to change.
    expect(result.current.startDate).toBeInstanceOf(Date);
  });
});
