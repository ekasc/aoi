/**
 * Web fallback: session-memory only. Drafts live in a JS Map for the tab
 * session and are lost on reload. This module makes NO persistent-security
 * claim — there is no encrypted durable manifest on web (persisting the
 * body or cache URIs to localStorage in plaintext would violate the
 * durability-privacy rule, so we persist nothing).
 *
 * Same export surface as native + default so the provider is unchanged.
 */
export * from '@/features/composer/composer-memory-adapters';
