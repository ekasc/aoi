import {
  sortLettersNewestFirst,
  type Letter,
  type LetterListResponse,
} from '@aoi/shared';

import { apiFetch } from '@/features/api-client';
import type { LettersRepository, SealLetterInput } from '@/features/letters/types';

/**
 * Remote letters repository. The server owns the lock: list responses omit
 * the body of every unopened letter (for the author too), and opening is an
 * atomic one-way transition. Sealed letters are immutable — there is no
 * edit or delete endpoint to call.
 */
export const remoteLettersRepository: LettersRepository = {
  async list() {
    const response = await apiFetch<LetterListResponse>('/v1/spaces/current/letters');
    return sortLettersNewestFirst(response.letters);
  },

  seal(input: SealLetterInput) {
    return apiFetch<Letter>('/v1/spaces/current/letters', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  open(letterId) {
    return apiFetch<Letter>(`/v1/letters/${letterId}/open`, {
      method: 'POST',
    });
  },
};
