import { apiFetch } from '@/features/api-client';
import type {
  CreateMomentResponseInput,
  MomentResponse,
  MomentResponseListResponse,
  MomentResponseRepository,
} from '@/features/responses/types';

/**
 * Server-backed responses, so both partners see the same exchange.
 *
 * The endpoint does not exist yet. It is written to the shape the rest of the
 * API already uses, so the client is complete and the local repository keeps
 * the feature working end to end until the route ships.
 */
export const remoteMomentResponseRepository: MomentResponseRepository = {
  async listForMoment(momentId) {
    const response = await apiFetch<MomentResponseListResponse>(
      `/v1/moments/${encodeURIComponent(momentId)}/responses`
    );
    return response.responses;
  },

  async add(input: CreateMomentResponseInput): Promise<MomentResponse> {
    return apiFetch<MomentResponse>(
      `/v1/moments/${encodeURIComponent(input.momentId)}/responses`,
      {
        method: 'POST',
        body: JSON.stringify({
          kind: input.kind,
          body: input.body ?? null,
          mediaPreview: input.mediaPreview ?? null,
          audioUri: input.audioUri ?? null,
        }),
      }
    );
  },
};
