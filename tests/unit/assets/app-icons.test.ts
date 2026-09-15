import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Production asset hygiene: the bundle contains exactly the generated
 * Editorial Paper icon set — valid PNGs at the sizes the platforms
 * require — and no dev-only design routes.
 */
const IMAGES = join(import.meta.dirname, '../../../assets/images');

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  );
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

describe('app icon set', () => {
  it('ships the generated set at platform sizes', () => {
    expect(pngSize(join(IMAGES, 'icon.png'))).toEqual({ width: 1024, height: 1024 });
    expect(pngSize(join(IMAGES, 'splash-icon.png'))).toEqual({ width: 1024, height: 1024 });
    expect(pngSize(join(IMAGES, 'android-icon-foreground.png'))).toEqual({ width: 1024, height: 1024 });
    expect(pngSize(join(IMAGES, 'android-icon-background.png'))).toEqual({ width: 512, height: 512 });
    expect(pngSize(join(IMAGES, 'android-icon-monochrome.png'))).toEqual({ width: 432, height: 432 });
    expect(pngSize(join(IMAGES, 'favicon.png'))).toEqual({ width: 48, height: 48 });
  });

  it('contains no template-era leftovers', () => {
    const actual = readdirSync(IMAGES).sort();
    expect(actual).toEqual(
      [
        'android-icon-background.png',
        'android-icon-foreground.png',
        'android-icon-monochrome.png',
        'favicon.png',
        'frosted-backdrop.png',
        'icon.png',
        'memory-sky-cloud-a.png',
        'memory-sky-cloud-b.png',
        'midnight-scrim.png',
        'midnight-window.jpg',
        'midnight-window.source.md',
        'splash-icon.png',
      ].sort()
    );
  });

  it('dev-only splash experiments are not reachable in production', () => {
    const root = join(import.meta.dirname, '../../..');
    expect(existsSync(join(root, 'app/splash-lab.tsx'))).toBe(false);
    expect(existsSync(join(root, 'components/splash'))).toBe(false);
    expect(existsSync(join(root, 'config/splash-variant.ts'))).toBe(false);
  });
});
