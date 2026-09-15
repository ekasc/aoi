import { spacePlusResponseSchema, type SpacePlusResponse } from '@aoi/shared';

import { apiFetch } from '@/features/api-client';

/**
 * Authoritative Space Plus read (P8A). Returns the parsed server row, or
 * null when it cannot be known (no session, no Space, offline, server
 * error). Null is UNKNOWN — callers must never collapse it into free or
 * plus; protected behavior fails safely (not-plus) while unknown.
 */
export async function fetchSpacePlus(): Promise<SpacePlusResponse | null> {
  try {
    const data = await apiFetch<unknown>('/v1/spaces/current/plus');
    return spacePlusResponseSchema.parse(data);
  } catch {
    return null;
  }
}
