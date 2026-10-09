import * as ExpoCrypto from 'expo-crypto';

/**
 * Hermes ships no Web Crypto.
 *
 * Not "no `getRandomValues`" — no `crypto` global at all. That distinction
 * matters, because the two obvious defences both fail against it: optional
 * chaining still throws a ReferenceError on an undeclared identifier, and a
 * `typeof crypto !== 'undefined'` guard is the only check that actually holds.
 * Every `crypto?.x` in this codebase was silently a crash waiting to happen.
 *
 * What breaks without it is not cosmetic. `@noble/curves` v2 refuses to
 * generate a single key and throws "crypto.getRandomValues must be defined"
 * from `randomBytes`, which takes out album key generation, the PKCE verifier
 * in the OAuth client, and media nonces. It surfaced as a render crash on the
 * dev Album tab, but nothing about the fault was local to that tab.
 *
 * `expo-crypto` is already a dependency and its `getRandomValues` takes and
 * returns the same typed array the Web Crypto method does, so it is a drop-in
 * rather than a shim. It is the OS CSPRNG underneath (`expo-random` → native),
 * which is what `features/album/crypto.ts` already documents that it wants.
 * Nothing here weakens a guarantee to make a call succeed: if a platform ever
 * provides a real one, this leaves it alone.
 */
export function installGlobalCrypto(): void {
  const scope = globalThis as { crypto?: Crypto };
  if (typeof scope.crypto?.getRandomValues === 'function') return;

  const getRandomValues = ExpoCrypto.getRandomValues.bind(ExpoCrypto) as unknown as Crypto['getRandomValues'];

  scope.crypto = { getRandomValues } as Crypto;
}
