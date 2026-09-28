/**
 * What this particular build is allowed to offer.
 *
 * A build made with `AOI_DEV_NO_CAPABILITIES=1` has push notifications and
 * Sign in with Apple stripped from its entitlements, because a free Apple
 * Developer account cannot be issued a provisioning profile for an app that
 * asks for either. The real build is untouched.
 *
 * This lives apart from the auth screen on purpose. It is a pure reading of
 * the build's config, so it has no native imports and can be asserted
 * directly, rather than dragged into a test through a module registry.
 */
export type BuildCapabilities = {
  /** True when the binary was built with capabilities removed. */
  stripped?: boolean;
  /** Push notifications. Off in a stripped build, and never faked. */
  push?: boolean;
  /** Sign in with Apple. Off in a stripped build, and never faked. */
  appleSignIn?: boolean;
};

export function buildCapabilities(extra: unknown): BuildCapabilities {
  const stripped =
    Boolean(extra) &&
    typeof extra === 'object' &&
    (extra as { devStrippedCapabilities?: unknown }).devStrippedCapabilities === true;

  // Push is not offered rather than offered-and-broken. A control that looks
  // like it works and does not is worse than a missing one.
  return {
    stripped,
    push: !stripped,
    appleSignIn: !stripped,
  };
}
