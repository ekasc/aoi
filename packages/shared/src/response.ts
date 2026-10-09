import { z } from 'zod';

export const RESPONSE_BODY_MAX_LENGTH = 400;
export const momentResponseKindSchema = z.enum(['tap', 'photo', 'voice', 'word']);
export type MomentResponseKind = z.infer<typeof momentResponseKindSchema>;

export const createMomentResponseRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tap') }).strict(),
  z.object({ kind: z.literal('word'), body: z.string().trim().min(1).max(RESPONSE_BODY_MAX_LENGTH) }).strict(),
  z.object({ kind: z.literal('photo'), mediaId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('voice'), mediaId: z.string().uuid() }).strict(),
]);
export type CreateMomentResponseRequest = z.infer<typeof createMomentResponseRequestSchema>;

export const momentResponseSchema = z.object({
  id: z.string(),
  momentId: z.string(),
  authorId: z.string(),
  authorRole: z.enum(['you', 'partner']),
  authorName: z.string(),
  kind: momentResponseKindSchema,
  body: z.string().nullable(),
  mediaPreview: z.string().nullable(),
  audioUri: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type MomentResponse = z.infer<typeof momentResponseSchema>;
export const momentResponseListResponseSchema = z.object({ responses: z.array(momentResponseSchema), nextCursor: z.string().uuid().optional() });
export type MomentResponseListResponse = z.infer<typeof momentResponseListResponseSchema>;
export const momentResponsePageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  cursor: z.string().uuid().optional(),
});
export type MomentResponsePageQuery = z.infer<typeof momentResponsePageQuerySchema>;
