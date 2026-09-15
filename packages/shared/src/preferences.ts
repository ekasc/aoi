import { z } from 'zod';

export const THEME_IDS = ['sunset-shore', 'sea-glass', 'deep-ocean'] as const;

export const themeIdSchema = z.enum(THEME_IDS);

export type ThemeId = z.infer<typeof themeIdSchema>;

export const userPreferencesSchema = z.object({
  themeId: themeIdSchema,
});

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const updateUserPreferencesRequestSchema = z.object({
  themeId: themeIdSchema.optional(),
});

export type UpdateUserPreferencesRequest = z.infer<
  typeof updateUserPreferencesRequestSchema
>;
