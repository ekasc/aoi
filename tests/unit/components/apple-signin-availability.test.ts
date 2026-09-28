import { describe, it, expect } from 'vitest';

import { buildCapabilities } from '@/features/auth/capabilities';

/**
 * A build made with `AOI_DEV_NO_CAPABILITIES=1` has no Sign in with Apple
 * entitlement, because a free Apple account cannot be issued a profile for an
 * app that asks for one. The trap is that `isAvailableAsync` still answers
 * true there: the framework is linked, only the capability is gone. So the
 * button renders, looks right, and fails on tap.
 */
describe('build capabilities', () => {
  it('drops Apple sign-in and push when the build stripped them', () => {
    const caps = buildCapabilities({ devStrippedCapabilities: true });
    expect(caps.appleSignIn).toBe(false);
    expect(caps.push).toBe(false);
    expect(caps.stripped).toBe(true);
  });

  it('keeps both on a normal build, with or without extra config', () => {
    for (const extra of [undefined, {}, { devStrippedCapabilities: false }]) {
      const caps = buildCapabilities(extra);
      expect(caps.appleSignIn).toBe(true);
      expect(caps.push).toBe(true);
    }
  });

  it('is not fooled by a truthy value that is not the flag', () => {
    // `devStrippedCapabilities: 0` would pass a loose `if`. Only the real
    // flag counts, because a mistake here removes a feature from a release.
    expect(buildCapabilities({ devStrippedCapabilities: 0 }).stripped).toBe(false);
    expect(buildCapabilities({ devStrippedCapabilities: 'yes' }).stripped).toBe(false);
    expect(buildCapabilities('nonsense').stripped).toBe(false);
  });
});
