import type { BeachThemeColors } from '@/constants/theme-presets';

/** The dark half of a theme: the landing is dark in both system schemes. */
type LandingColors = BeachThemeColors;

export type LandingTheme = {
  background: string;
  ink: string;
  subtle: string;
  border: string;
};

export const LANDING_ERROR = '#ffb4ab';

/**
 * The get-started screen is dark whatever the system is doing, because the
 * backdrop is a night window: a photograph of a dark room. The ink has to be
 * light for that art.
 *
 * What it must not be is a *fixed* light grey. It used to be a mauve copied
 * out of the artwork and hardcoded here, which meant a reader on Sunset
 * Shore walked through a screen of one grey and then into an app of another.
 * So the values come from the app's own dark tokens, which keeps the landing
 * in the same family as whatever theme the reader picked and keeps its
 * contrast audited by the same tests as everything else.
 *
 * A scrim carries the rest: it is what guarantees the ink clears the photo
 * rather than hoping the photo is dark enough.
 */
export function landingThemeForColorScheme(dark: LandingColors): LandingTheme {
  return {
    background: dark.background,
    ink: dark.textPrimary,
    subtle: dark.textSecondary,
    border: dark.borderStrong,
  };
}
