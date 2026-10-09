import { z } from 'zod';

export const PARTNER_DETAIL_TEXT_MAX_LENGTH = 400;
export const partnerDetailCategorySchema = z.enum(['favorite', 'habit', 'quirk', 'words', 'other']);
export type PartnerDetailCategory = z.infer<typeof partnerDetailCategorySchema>;

export const createPartnerDetailRequestSchema = z.object({
  text: z.string().trim().min(1).max(PARTNER_DETAIL_TEXT_MAX_LENGTH),
  category: partnerDetailCategorySchema.default('other'),
}).strict();
export type CreatePartnerDetailRequest = z.infer<typeof createPartnerDetailRequestSchema>;

export const partnerDetailSchema = z.object({
  id: z.string(),
  text: z.string(),
  category: partnerDetailCategorySchema,
  createdAt: z.string().datetime(),
});
export type PartnerDetail = z.infer<typeof partnerDetailSchema>;
export const partnerDetailListResponseSchema = z.object({ details: z.array(partnerDetailSchema) });
