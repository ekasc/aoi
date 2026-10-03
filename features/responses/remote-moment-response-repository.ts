import { apiFetch } from '@/features/api-client';
import { uploadMediaAsset } from '@/features/media/media-upload-service';
import { createMomentResponseRequestSchema, momentResponseListResponseSchema, momentResponseSchema, type CreateMomentResponseRequest } from '@aoi/shared';
import type {
  CreateMomentResponseInput,
  MomentResponse,
  MomentResponseListResponse,
  MomentResponseRepository,
} from '@/features/responses/types';

/**
 * Server-backed responses, so both partners see the same exchange.
 *
 * Media uses the existing authorized upload pipeline. Device URIs and client
 * author fields never cross the response API boundary.
 */
export const remoteMomentResponseRepository: MomentResponseRepository = {
  async listForMoment(momentId) {
    const response = await apiFetch<MomentResponseListResponse>(
      `/v1/moments/${encodeURIComponent(momentId)}/responses`
    );
    return momentResponseListResponseSchema.parse(response).responses;
  },

  async add(input: CreateMomentResponseInput, assertScope = () => {}): Promise<MomentResponse> {
    assertScope();
    let payload: CreateMomentResponseRequest;
    if (input.kind === 'tap') {
      payload = { kind: 'tap' };
    } else if (input.kind === 'word') {
      payload = createMomentResponseRequestSchema.parse({ kind: 'word', body: input.body });
    } else {
      const uri = input.kind === 'photo' ? input.mediaPreview : input.audioUri;
      if (!uri) throw new Error('Choose media for this response.');
      const uploaded = await uploadMediaAsset({ uri, mimeType: input.mimeType ?? (input.kind === 'photo' ? 'image/jpeg' : 'audio/m4a') }, undefined, assertScope);
      assertScope();
      if (!uploaded.mediaId) throw new Error('Media could not be uploaded.');
      payload = { kind: input.kind, mediaId: uploaded.mediaId };
    }
    assertScope();
    const response = await apiFetch<MomentResponse>(
      `/v1/moments/${encodeURIComponent(input.momentId)}/responses`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    assertScope();
    return momentResponseSchema.parse(response);
  },
};
