import { apiFetch } from '@/features/api-client';
import type {
  CreateMomentInput,
  Moment,
  SpaceActivityResponse,
  UpdateMomentInput,
} from '@/features/moments/types';

export interface MomentListResponse {
  moments: Moment[];
  nextCursor?: string;
}

export async function fetchMoments(
  cursor?: string,
  limit = 20
): Promise<MomentListResponse> {
  let path = `/v1/spaces/current/moments?limit=${limit}`;
  if (cursor) {
    path += `&cursor=${encodeURIComponent(cursor)}`;
  }
  return apiFetch<MomentListResponse>(path);
}

export async function createMoment(input: CreateMomentInput): Promise<Moment> {
  return apiFetch<Moment>('/v1/spaces/current/moments', {
    method: 'POST',
    body: JSON.stringify({
      type: input.type,
      title: input.title,
      body: input.body,
      occurredAt: input.occurredAt,
      targetAt: input.targetAt ?? null,
      mediaPreview: input.mediaPreview ?? null,
      audioUri: input.audioUri ?? null,
    }),
  });
}

export async function updateMoment(
  momentId: string,
  input: UpdateMomentInput
): Promise<Moment> {
  return apiFetch<Moment>(`/v1/moments/${momentId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      type: input.type,
      title: input.title,
      body: input.body,
      occurredAt: input.occurredAt,
      targetAt: input.targetAt,
      mediaPreview: input.mediaPreview,
      audioUri: input.audioUri,
    }),
  });
}

export async function deleteMoment(momentId: string): Promise<void> {
  await apiFetch(`/v1/moments/${momentId}`, {
    method: 'DELETE',
  });
}

export async function fetchActivity(): Promise<SpaceActivityResponse> {
  return apiFetch<SpaceActivityResponse>('/v1/spaces/current/activity');
}
