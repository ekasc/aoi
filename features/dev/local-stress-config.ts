import rawConfig from './local-stress-config.json';

import type { AuthSessionPayload } from '@/features/auth/types';

export type LocalStressConfig = {
  baseUrl: string;
  profile: string;
  session: AuthSessionPayload;
};

export function getLocalStressConfig(): LocalStressConfig | null {
  if (typeof __DEV__ === 'undefined' || !__DEV__ || rawConfig === null) return null;
  const value: unknown = rawConfig;
  if (!value || typeof value !== 'object' || !('baseUrl' in value) || !('session' in value) || !('profile' in value)) {
    throw new Error('Invalid local stress configuration');
  }
  if (typeof value.baseUrl !== 'string' || typeof value.profile !== 'string') throw new Error('Invalid local stress configuration');
  const url = new URL(value.baseUrl);
  if (url.protocol !== 'http:' || !/^(127\.0\.0\.1|localhost|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)$/.test(url.hostname)) {
    throw new Error('Stress traffic must stay on loopback or a private LAN');
  }
  const session = value.session;
  if (!session || typeof session !== 'object' || !('user' in session) || !('tokens' in session)) throw new Error('Invalid stress session');
  const { user, tokens } = session;
  if (!user || typeof user !== 'object' || !('id' in user) || !('email' in user) || !('displayName' in user)
    || typeof user.id !== 'string' || typeof user.email !== 'string' || !user.email.endsWith('@stress.invalid') || typeof user.displayName !== 'string'
    || !tokens || typeof tokens !== 'object' || !('accessToken' in tokens) || typeof tokens.accessToken !== 'string' || !tokens.accessToken.startsWith('stress-')) {
    throw new Error('Only synthetic stress identities are allowed');
  }
  return { baseUrl: value.baseUrl, profile: value.profile, session: { user: { id: user.id, email: user.email, displayName: user.displayName }, tokens: { accessToken: tokens.accessToken } } };
}
