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

function readUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^(https:\/\/|mailto:)/i.test(trimmed)) return trimmed;
  return null;
}

export function getLegalLinks(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): LegalLinks {
  return {
    privacyUrl: readUrl(env.EXPO_PUBLIC_PRIVACY_URL),
    termsUrl: readUrl(env.EXPO_PUBLIC_TERMS_URL),
    supportUrl: readUrl(env.EXPO_PUBLIC_SUPPORT_URL),
  };
}
