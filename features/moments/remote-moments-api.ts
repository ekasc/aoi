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
  limit = 20,
  range?: { fromMs?: number; toMs?: number; type?: string }
): Promise<MomentListResponse> {
  let path = `/v1/spaces/current/moments?limit=${limit}`;
  if (cursor) {
    path += `&cursor=${encodeURIComponent(cursor)}`;
  }
  if (range?.fromMs !== undefined) {
    path += `&fromMs=${range.fromMs}`;
  }
  if (range?.toMs !== undefined) {
    path += `&toMs=${range.toMs}`;
  }
  if (range?.type !== undefined) {
    path += `&type=${encodeURIComponent(range.type)}`;
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
      mediaId: input.mediaId ?? null,
      // Ordered attachments (image/audio only, max 10, `{ mediaId, kind }`).
      // Omitted = legacy single-media path; supplied = the attachment set.
      // The server re-derives legacy mediaPreview/audioUri/mediaId from the
      // first image/audio for old clients.
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
      // Draft-derived idempotency key: a double-tap replays the first
      // result server-side instead of creating a second moment.
      clientId: input.clientId,
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
      mediaId: input.mediaId,
      // Omitted = attachments untouched; supplied (even `[]`) = replace.
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
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
