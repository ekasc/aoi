import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PREVIEW = readFileSync('app/dev-calendar.tsx', 'utf8');
const PLANS = readFileSync('app/(app)/(tabs)/plans.tsx', 'utf8');
const PLANS_PREVIEW = readFileSync('app/dev-plans.tsx', 'utf8');

/** Every context hook the calendar screen reads, and the provider that feeds it. */
const PROVIDERS: Record<string, string> = {
  useCalendar: 'CalendarProvider',
  useMoments: 'MomentsProvider',
  useSomeday: 'SomedayProvider',
  useSpace: 'SpaceContext.Provider',
};

describe('Calendar dev preview', () => {
  it('lets the Plans preview request an empty variant instead of forcing samples', () => {
    expect(PLANS_PREVIEW).toContain('useApplyPreviewVariant(parsePreviewVariant(variant))');
    expect(PLANS_PREVIEW).toContain('useLocalSearchParams');
    expect(PLANS_PREVIEW).not.toContain('useApplyPreviewVariant("full")');
  });
  it('is development only and cannot be reached in a production build', () => {
    expect(PREVIEW).toContain('if (!__DEV__)');
    expect(PREVIEW).toContain('return <Redirect href="/" />');
  });

  it('offers the calendar screens that have no tab', () => {
    expect(PREVIEW).toContain("'plans'");
    expect(PREVIEW).toContain("'year'");
    expect(PREVIEW).toContain('<PlansScreen />');
    expect(PREVIEW).toContain('<CalendarYearScreen />');
  });

  it('feeds every provider the calendar screen reads', () => {
    // The preview exists to render the screen as it ships. A context added to
    // the screen but not to the preview tree is a crash the moment you open it,
    // which is exactly the class of thing a preview is meant to catch.
    for (const [hook, provider] of Object.entries(PROVIDERS)) {
      if (!PLANS.includes(`${hook}(`)) {
        continue;
      }
      expect(
        PREVIEW.includes(provider),
        `dev-calendar.tsx is missing ${provider} for ${hook}`,
      ).toBe(true);
    }
  });

  it('renders the same screen components the app does, not copies', () => {
    expect(PREVIEW).toContain('@/app/(app)/(tabs)/plans');
    expect(PREVIEW).toContain('@/app/(app)/calendar/year');
  });
});
