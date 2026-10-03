import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(path, 'utf8');

describe('relationship home product boundary', () => {
  it('does not mount the discovery provider, even with saved discovery preferences', () => {
    expect(source('app/(app)/_layout.tsx')).not.toMatch(/AutomaticAlbumProvider|automatic-album/);
    expect(source('app/(app)/(tabs)/together.tsx')).not.toMatch(/useSkyPhotos|useAutomaticAlbum|features\/album|face-recognition/);
  });
  it('neutralizes old recognition deep links without importing a scanner', () => {
    const route = source('app/(app)/album/check-photo.tsx');
    expect(route).toContain('href="/(app)/(tabs)/together"');
    expect(route).not.toMatch(/PhotoCheckScreen|useAutomaticAlbum/);
  });
  it('keeps the dev recognition experiment gated and out of navigation', () => {
    expect(source('app/dev-album.tsx')).toContain('if (!__DEV__)');
    expect(source('components/album/automatic-album-sheet.tsx')).toContain('Inactive in the product.');
    expect(source('app/(app)/(tabs)/_layout.tsx')).not.toContain('/dev-album');
  });
  it('does not branch the relationship home on a subscription', () => {
    expect(source('app/(app)/(tabs)/together.tsx')).not.toMatch(/useSubscription|isPlus|paywall/);
  });
});
