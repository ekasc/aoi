export type ThemeId = 'sunset-shore' | 'sea-glass' | 'deep-ocean';

export type UserPreferences = {
  themeId: ThemeId;
};

export type UpdateUserPreferencesRequest = {
  themeId?: ThemeId;
};
