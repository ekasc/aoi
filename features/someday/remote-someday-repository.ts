import { apiFetch } from '@/features/api-client';
import { sortSomedayItems } from '@/features/someday/someday-order';
import type {
  CreateSomedayItemInput,
  SomedayItem,
  SomedayListResponse,
  SomedayRepository,
  UpdateSomedayItemInput,
} from '@/features/someday/types';

export const remoteSomedayRepository: SomedayRepository = {
  async list() {
    const response = await apiFetch<SomedayListResponse>(
      '/v1/spaces/current/someday'
    );
    // The server already returns canonical order; sorting again keeps parity
    // with the local repository no matter what.
    return sortSomedayItems(response.items);
  },

  async add(input: CreateSomedayItemInput) {
    return apiFetch<SomedayItem>('/v1/spaces/current/someday', {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        note: input.note,
        category: input.category ?? 'other',
      }),
    });
  },

  async update(itemId: string, input: UpdateSomedayItemInput) {
    return apiFetch<SomedayItem>(`/v1/someday/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
};
