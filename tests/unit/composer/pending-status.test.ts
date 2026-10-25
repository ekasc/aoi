import { describe, expect, it } from 'vitest';

import { pendingStatusLabel } from '@/features/composer/pending-status';

describe('pendingStatusLabel', () => {
  it('calls a delivered row sent, never unsent', () => {
    expect(pendingStatusLabel('delivered', false, null)).toBe('Sent');
  });

  it('distinguishes queued, sending, and failed', () => {
    expect(pendingStatusLabel('queued', false, null)).toBe('Waiting to send');
    expect(pendingStatusLabel('sending', false, null)).toBe('Sending…');
    expect(pendingStatusLabel('failed', false, 'Offline')).toBe('Offline');
    expect(pendingStatusLabel('failed', false, null)).toBe('Could not send yet.');
  });
});
