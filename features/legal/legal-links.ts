/**
 * Legal/support destinations (P9B). Production URLs are configuration, not
 * code: they arrive via EXPO_PUBLIC_* vars. Absent values mean the row is
 * not rendered at all — never a fake or placeholder link. http(s) and
 * mailto: are the only accepted schemes.
 */

export type LegalLinks = {
  privacyUrl: string | null;
  termsUrl: string | null;
  supportUrl: string | null;
};

function readUrl(value: string | undefined, allowEmail = false): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return trimmed;
    if (allowEmail && url.protocol === 'mailto:' && url.pathname.includes('@')) return trimmed;
  } catch {
    return null;
  }
  return null;
}

export function getLegalLinks(
  env: Record<string, string | undefined> = {
    // Expo only inlines direct property access in the shipped bundle.
    EXPO_PUBLIC_PRIVACY_URL: process.env.EXPO_PUBLIC_PRIVACY_URL,
    EXPO_PUBLIC_TERMS_URL: process.env.EXPO_PUBLIC_TERMS_URL,
    EXPO_PUBLIC_SUPPORT_URL: process.env.EXPO_PUBLIC_SUPPORT_URL,
  }
): LegalLinks {
  return {
    privacyUrl: readUrl(env.EXPO_PUBLIC_PRIVACY_URL),
    termsUrl: readUrl(env.EXPO_PUBLIC_TERMS_URL),
    supportUrl: readUrl(env.EXPO_PUBLIC_SUPPORT_URL, true),
  };
}
