import { expect, it, vi } from 'vitest';

import { trackForeground } from '@/features/dev/foreground-tracker';

function fixture(currentState: string | null) {
  let notify = (_state: string) => {};
  const unsubscribe = vi.fn();
  const tracker = trackForeground({ currentState, subscribe: listener => { notify = listener; return unsubscribe; } });
  return { tracker, notify: (state: string) => notify(state), unsubscribe };
}

it('accepts continuous foreground activity', () => {
  const { tracker, notify } = fixture('active');
  notify('active');
  expect(tracker.snapshot().valid).toBe(true);
  tracker.stop();
});

it('does not let returning to the app validate an interrupted interval', () => {
  const { tracker, notify } = fixture('active');
  notify('inactive'); notify('background'); notify('active');
  expect(tracker.snapshot().valid).toBe(false);
  expect(tracker.snapshot().events.map(event => event.state)).toEqual(['inactive', 'background', 'active']);
  tracker.stop();
});

it.each([null, 'background', 'unknown'])('rejects a run beginning in %s', state => {
  const { tracker } = fixture(state);
  expect(tracker.snapshot().valid).toBe(false);
  tracker.stop();
});

it('removes its listener exactly once and ignores late events', () => {
  const { tracker, notify, unsubscribe } = fixture('active');
  tracker.stop(); tracker.stop(); notify('background');
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(tracker.snapshot().events).toEqual([]);
});
