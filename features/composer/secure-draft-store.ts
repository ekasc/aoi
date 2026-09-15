/**
 * Default (test-safe) composer durability backend.
 *
 * Metro platform resolution: native loads `secure-draft-store.native.ts`
 * (SecureStore + Documents + expo-crypto AES-GCM); web loads
 * `secure-draft-store.web.ts` (session-memory only). This default module is
 * what unit tests / Node resolve — memory adapters + WebCrypto AES-GCM, no
 * native modules — so pure tests exercise the real encrypt/persist path.
 */
export * from '@/features/composer/composer-memory-adapters';
