import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ResponsesProvider, useResponses } from '@/features/responses/responses-context';
import type { MomentResponse } from '@/features/responses/types';

const repository = vi.hoisted(() => ({ listForMoment: vi.fn(), add: vi.fn() }));
const identity = vi.hoisted(() => ({ userId: 'you', spaceId: 'space' }));

vi.mock('@/features/api-client', () => ({ isStubMode: () => true }));
vi.mock('@/features/session/session-context', () => ({ useSession: () => ({ user: { id: identity.userId } }) }));
vi.mock('@/features/space/space-context', () => ({ useSpace: () => ({ space: { id: identity.spaceId } }) }));
vi.mock('@/features/responses/local-moment-response-repository', () => ({ createLocalMomentResponseRepository: () => repository }));

beforeEach(() => {
  repository.listForMoment.mockReset();
  repository.listForMoment.mockResolvedValue([]);
  repository.add.mockReset();
  identity.userId = 'you';
  identity.spaceId = 'space';
});

function renderResponses() {
  return renderHook(() => useResponses(), {
    wrapper: ({ children }) => <ResponsesProvider>{children}</ResponsesProvider>,
  });
}

describe('Response read states', () => {
  it('invalidates an in-flight response upload when the active space changes', async () => {
    let assertScope: () => void = () => {};
    let rejectSend: (error: Error) => void = () => {};
    repository.add.mockImplementation((_input, check) => {
      assertScope = check;
      return new Promise((_, reject) => { rejectSend = reject; });
    });
    const { result, rerender } = renderResponses();
    let pending = Promise.resolve(false);
    act(() => { pending = result.current.add({ momentId: 'memory', authorId: 'you', authorRole: 'you', authorName: 'You', kind: 'tap' }); });
    act(() => { identity.spaceId = 'other-space'; rerender(); });
    expect(assertScope).toThrow('The active space changed.');
    await act(async () => { rejectSend(new Error('scope changed')); await pending; });
    expect(await pending).toBe(false);
    expect(result.current.responses).toEqual([]);
  });
  it('distinguishes a failed read from an empty read and allows retrying the same memory', async () => {
    repository.listForMoment.mockRejectedValueOnce(new Error('private storage failure'));
    const { result } = renderResponses();
    await act(async () => result.current.loadFor('memory'));
    expect(result.current.error).toBe('Could not load responses.');
    expect(result.current.isLoading).toBe(false);
    await act(async () => result.current.loadFor('memory'));
    expect(repository.listForMoment).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.responses).toEqual([]);
  });

  it('reports a pending read as loading, not a completed empty read', async () => {
    let finish: (responses: MomentResponse[]) => void = () => {};
    repository.listForMoment.mockReturnValue(new Promise<MomentResponse[]>((resolve) => { finish = resolve; }));
    const { result } = renderResponses();
    await act(async () => { result.current.loadFor('memory'); });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => finish([]));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.responses).toEqual([]);
  });

  it('ignores a failed read after the memory has been closed', async () => {
    let fail: (error: Error) => void = () => {};
    repository.listForMoment.mockReturnValue(new Promise<MomentResponse[]>((_, reject) => { fail = reject; }));
    const { result } = renderResponses();
    await act(async () => { result.current.loadFor('memory'); });
    await act(async () => { result.current.loadFor(null); });
    await act(async () => fail(new Error('late failure')));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.responses).toEqual([]);
  });
});
