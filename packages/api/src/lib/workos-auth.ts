import { WorkOS } from '@workos-inc/node';
import type { AuthenticationResponse } from '@workos-inc/node';

function getWorkOS() {
  const apiKey = process.env.WORKOS_API_KEY;
  const clientId = process.env.WORKOS_CLIENT_ID;

  if (!apiKey) {
    throw new Error('WORKOS_API_KEY environment variable is required');
  }

  if (!clientId) {
    throw new Error('WORKOS_CLIENT_ID environment variable is required');
  }

  return { clientId, workos: new WorkOS(apiKey) };
}

export type WorkOSIdentity = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
};

function workosUserToIdentity(user: AuthenticationResponse['user']): WorkOSIdentity {
  const first = user.firstName ?? '';
  const last = user.lastName ?? '';
  const displayName = [first, last].filter(Boolean).join(' ').trim() || user.email;

  return {
    id: user.id,
    email: user.email,
    displayName,
    avatarUrl: user.profilePictureUrl ?? undefined,
  };
}

export async function getAuthorizationUrl(
  provider: string,
  redirectUri: string,
): Promise<string> {
  const { workos, clientId } = getWorkOS();

  return workos.userManagement.getAuthorizationUrl({
    clientId,
    provider,
    redirectUri,
  });
}

export async function authenticateWithCode(code: string): Promise<{
  user: WorkOSIdentity;
  accessToken: string;
  refreshToken: string;
}> {
  const { workos, clientId } = getWorkOS();
  const response = await workos.userManagement.authenticateWithCode({
    clientId,
    code,
  });

  return {
    user: workosUserToIdentity(response.user),
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
  };
}

export async function authenticateWithAppleNative(
  idToken: string,
  nonce: string,
): Promise<{
  user: WorkOSIdentity;
  accessToken: string;
  refreshToken: string;
}> {
  const { workos, clientId } = getWorkOS();
  const response = await workos.userManagement.authenticateWithCode({
    clientId,
    code: idToken,
    codeVerifier: nonce,
  });

  return {
    user: workosUserToIdentity(response.user),
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
  };
}
