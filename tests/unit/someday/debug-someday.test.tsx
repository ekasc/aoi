import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import * as fs from 'node:fs';

import { SomedayProvider, useSomeday } from '@/features/someday/someday-context';
import type { SomedayContextValue, SomedayItem } from '@/features/someday/types';

const log = (msg: string) => fs.appendFileSync('/tmp/someday-debug.log', msg + '\n');

const fakeRepository = { list: vi.fn(), add: vi.fn(), update: vi.fn() };

vi.mock('@/features/someday/local-someday-repository', () => ({
  createLocalSomedayRepository: () => fakeRepository,
}));
vi.mock('@/features/session/session-context', () => ({
  useSession: () => ({ user: { id: 'user-you', displayName: 'You', email: 'you@aoi.test' } }),
}));

let captured: SomedayContextValue | null = null;
function Probe() { captured = useSomeday(); return null; }

function makeItem(overrides: Partial<SomedayItem> = {}): SomedayItem {
  return {
    id: `someday_${Math.floor(Math.random() * 1000000)}`, title: 'A picnic on the hill',
    category: 'place', createdByRole: 'you',
    createdAt: '2026-07-01T10:00:00.000Z', checkedAt: null, checkedByRole: null, ...overrides,
  };
}

async function renderProvider() {
  const view = render(<SomedayProvider><Probe /></SomedayProvider>);
  await waitFor(() => expect(captured?.isLoading).toBe(false));
  return view;
}

describe('dbg', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    captured = null;
    fs.writeFileSync('/tmp/someday-debug.log', '');
  });

  it('resurrect', async () => {
    const done = makeItem({
      id: 's1', title: 'Night market',
      checkedAt: '2026-07-20T10:00:00.000Z', checkedByRole: 'partner',
    });
    fakeRepository.list.mockResolvedValue([done]);
    await renderProvider();

    let rejectFirst: ((error: Error) => void) | undefined;
    const serverRechecked: SomedayItem = { ...done, checkedAt: '2026-08-02T09:00:00.000Z', checkedByRole: 'you' };
    fakeRepository.update
      .mockImplementationOnce(() => { log('update #1 consumed'); return new Promise<SomedayItem>((_resolve, reject) => { rejectFirst = reject; }); })
      .mockImplementationOnce(() => { log('update #2 consumed'); return Promise.resolve(serverRechecked); });

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    await act(async () => { first = captured?.setChecked('s1', false); });
    log('after act1: ' + JSON.stringify(captured?.items));
    await act(async () => { second = captured?.setChecked('s1', true); });
    log('after act2: ' + JSON.stringify(captured?.items));
    await act(async () => {
      await second;
      log('after await second: ' + JSON.stringify(captured?.items));
      rejectFirst?.(new Error('network down'));
      await first;
      log('after await first: ' + JSON.stringify(captured?.items));
    });
    log('final: ' + JSON.stringify(captured?.items));
    expect(captured?.openItems).toEqual([]);
  });
});
