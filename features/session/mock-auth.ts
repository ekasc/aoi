import type { SessionUser } from '@/features/session/types';

export const MOCK_VERIFY_CODE = '111111';

export function createMockUser(email: string): SessionUser {
  const localPart = email.split('@')[0] ?? 'you';
  const displayName =
    localPart.charAt(0).toUpperCase() + localPart.slice(1).toLowerCase();

  return {
    id: `user_${localPart}`,
    email,
    displayName,
  };
}
