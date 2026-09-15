import { z } from 'zod';

/**
 * The canonical error envelope for every Aoi API response. `code` is a
 * stable machine-readable identifier; `message` is a fixed, user-safe string
 * (never a stack trace, never request content, never coordinates).
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /**
     * Optional machine-readable payload for typed limit errors
     * (see LimitDetails). Absent for every other error.
     */
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginationParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export type PaginationParams = z.infer<typeof paginationParamsSchema>;

export const dateRangeParamsSchema = z.object({
  from: z.string(),
  to: z.string(),
});

export type DateRangeParams = z.infer<typeof dateRangeParamsSchema>;
