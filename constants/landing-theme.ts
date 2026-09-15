export type LandingTheme = {
  background: string;
  ink: string;
  subtle: string;
  border: string;
};

// Fixed midnight theme — always dark in both system schemes.
const MIDNIGHT: LandingTheme = {
  background: '#120D13',
  ink: '#F6EDF3',
  subtle: '#C5B2C2',
  border: '#5C4255',
};

export const LANDING_ERROR = '#ffb4ab';

export function landingThemeForColorScheme(
  _colorScheme: string | null | undefined
): LandingTheme {
  return MIDNIGHT;
}

export const LANDING_BACKGROUND_DARK = MIDNIGHT.background;
export const LANDING_BACKGROUND_LIGHT = MIDNIGHT.background;

export function landingInk(_colorScheme: string | null | undefined): string {
  return MIDNIGHT.ink;
}

export function landingSubtle(_colorScheme: string | null | undefined): string {
  return MIDNIGHT.subtle;
}
