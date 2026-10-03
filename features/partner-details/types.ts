import type { PartnerDetailCategory } from '@aoi/shared';
export type { PartnerDetail, PartnerDetailCategory } from '@aoi/shared';

export type CreatePartnerDetailInput = {
  text: string;
  category?: PartnerDetailCategory;
};
