import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(path, 'utf8');

describe('relationship home product boundary', () => {
  it('neutralizes old recognition deep links without importing a scanner', () => {
    const route = source('app/(app)/album/check-photo.tsx');
    expect(route).toContain('href="/(app)/(tabs)/together"');
  });
  it('gates Sky History alone, never the live relationship', () => {
    const screen = source('app/(app)/(tabs)/together.tsx');
    expect(screen).toContain('useSubscription');
    expect(screen).toMatch(/<SkyHistoryControl[\s\S]*isPlus=\{plusActive\}/);
    expect(screen).not.toMatch(/<MemorySky[^>]*plus/i);
    expect(screen).toMatch(/paywall', params: \{ feature: 'sky-history' \} \}/);
    expect(source('app/(app)/paywall.tsx')).toContain("feature === 'sky-history'");
  });
});
