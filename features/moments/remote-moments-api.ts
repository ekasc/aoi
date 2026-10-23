import {
  MOMENT_RECONCILE_LIMIT,
  momentListResponseSchema,
  momentSchema,
  reconcileMomentsResponseSchema,
  type MomentListResponse,
} from '@aoi/shared';

import { apiFetch } from '@/features/api-client';
import type {
  CreateMomentInput,
  Moment,
  UpdateMomentInput,
} from '@/features/moments/types';

export type { MomentListResponse } from '@aoi/shared';

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
  return momentListResponseSchema.parse(await apiFetch<unknown>(path));
}

/** Revalidate only loaded records, with at most three bounded requests in flight. */
export async function reconcileMoments(
  loaded: readonly Pick<Moment, 'id'>[],
  assertCurrent: () => void
): Promise<Moment[]> {
  const ids = [...new Set(loaded.map((moment) => moment.id))];
  const moments: Moment[] = [];
  for (let offset = 0; offset < ids.length; offset += MOMENT_RECONCILE_LIMIT * 3) {
    const requests: Promise<Moment[]>[] = [];
    for (let start = offset; start < Math.min(offset + MOMENT_RECONCILE_LIMIT * 3, ids.length); start += MOMENT_RECONCILE_LIMIT) {
      const batch = ids.slice(start, start + MOMENT_RECONCILE_LIMIT);
      requests.push((async () => {
        assertCurrent();
        const result = await apiFetch<unknown>('/v1/spaces/current/moments/reconcile', {
          method: 'POST',
          body: JSON.stringify({ ids: batch }),
        });
        assertCurrent();
        const parsed = reconcileMomentsResponseSchema.parse(result);
        const requested = new Set(batch);
        if (parsed.moments.some((moment) => !requested.has(moment.id))) {
          throw new Error('Unexpected memory in refresh response');
        }
        return parsed.moments;
      })());
    }
    moments.push(...(await Promise.all(requests)).flat());
  }
  return moments;
}

export async function createMoment(input: CreateMomentInput): Promise<Moment> {
  return momentSchema.parse(await apiFetch<unknown>('/v1/spaces/current/moments', {
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
  }));
}

export async function updateMoment(
  momentId: string,
  input: UpdateMomentInput
): Promise<Moment> {
  return momentSchema.parse(await apiFetch<unknown>(`/v1/moments/${momentId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      expectedUpdatedAt: input.expectedUpdatedAt,
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
  }));
}

export async function deleteMoment(momentId: string, expectedUpdatedAt: string): Promise<void> {
  await apiFetch(`/v1/moments/${momentId}`, {
    method: 'DELETE',
    body: JSON.stringify({ expectedUpdatedAt }),
  });
}
