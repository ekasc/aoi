import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('device measurement cleanup', () => {
  it('unsubscribes foreground tracking when navigation aborts the run', async () => {
    const stop = vi.fn();
    const source = readFileSync('scripts/perf-device-scenarios.js', 'utf8');
    const result = runInNewContext(source, {
      process: { env: { EXPO_PUBLIC_AUTH_STUB_MODE: 'true', EXPO_PUBLIC_DEV_SEED: 'full' } },
      __aoiDebug: {
        trackForeground: () => ({ stop }),
        sleep: vi.fn(),
        navigate: async () => { throw new Error('device disconnected'); },
      },
    });
    await expect(result).rejects.toThrow('device disconnected');
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
