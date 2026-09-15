import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Generate a cryptographically random token as hex string. */
export function randomToken(length = 32): string {
  return randomBytes(length).toString('hex');
}

/** SHA-256 hash of a token for secure DB storage. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Generate an invite code (6 uppercase alphanumeric chars). */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/1/O/0 for readability
  let code = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/** Normalize an invite code for lookup (uppercase, no spaces). */
export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/\s/g, '');
}

/**
 * Constant-time secret comparison (webhook authorization). Never throws on
 * length mismatch — unequal lengths simply do not match.
 */
export function secretsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  return timingSafeEqual(a, b);
}
