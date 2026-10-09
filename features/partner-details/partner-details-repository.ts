import AsyncStorage from '@react-native-async-storage/async-storage';
import { partnerDetailListResponseSchema, partnerDetailSchema } from '@aoi/shared';

import { apiFetch, isStubMode } from '@/features/api-client';
import type { PartnerDetail } from '@/features/partner-details/types';

const DETAILS_KEY_PREFIX = 'aoi.partner-details.v1.';

function detailsKey(userId: string): string {
  return `${DETAILS_KEY_PREFIX}${userId}`;
}

async function readDetails(userId: string): Promise<PartnerDetail[]> {
  const rawValue = await AsyncStorage.getItem(detailsKey(userId));

  if (!rawValue) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item): item is PartnerDetail =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as PartnerDetail).id === 'string' &&
            typeof (item as PartnerDetail).text === 'string'
        )
    );
  } catch {
    return [];
  }
}

async function writeDetails(userId: string, details: PartnerDetail[]) {
  await AsyncStorage.setItem(detailsKey(userId), JSON.stringify(details));
}

export const partnerDetailsRepository = {
  async list(userId: string): Promise<PartnerDetail[]> {
    if (!isStubMode()) {
      return partnerDetailListResponseSchema.parse(await apiFetch<unknown>('/v1/users/me/partner-details')).details;
    }
    return readDetails(userId);
  },

  async add(userId: string, detail: PartnerDetail): Promise<PartnerDetail> {
    if (!isStubMode()) {
      return partnerDetailSchema.parse(await apiFetch<unknown>('/v1/users/me/partner-details', {
        method: 'POST', body: JSON.stringify({ text: detail.text, category: detail.category }),
      }));
    }
    const details = await readDetails(userId);
    await writeDetails(userId, [detail, ...details]);
    return detail;
  },

  async remove(userId: string, detailId: string): Promise<void> {
    if (!isStubMode()) {
      await apiFetch(`/v1/users/me/partner-details/${encodeURIComponent(detailId)}`, { method: 'DELETE' });
      return;
    }
    const details = await readDetails(userId);
    await writeDetails(
      userId,
      details.filter((detail) => detail.id !== detailId)
    );
  },
};
