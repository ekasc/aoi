import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Pure composer core must never load native modules, so unit tests exercise
 * real logic without SecureStore / FileSystem / expo-crypto. Only the
 * platform backends (`secure-draft-store.native.ts`) and the React provider
 * may import them.
 */
const PURE_FILES = [
  'features/composer/types.ts',
  'features/composer/validate.ts',
  'features/composer/composer-machine.ts',
  'features/composer/composer-store.ts',
  'features/composer/composer-memory-adapters.ts',
  'features/composer/send-pipeline.ts',
  'features/composer/secure-draft-store.ts',
  'features/composer/secure-draft-store.web.ts',
  'features/media/media-upload-service.ts',
];

const NATIVE_IMPORT = /from\s+['"]expo-(crypto|secure-store|file-system)[^'"]*['"]|require\(\s*['"]expo-(crypto|secure-store|file-system)/;

describe('composer pure core has no native imports', () => {
  for (const rel of PURE_FILES) {
    it(rel, () => {
      const full = join(process.cwd(), rel);
      const text = readFileSync(full, 'utf8');
      expect(`${rel} must not import native modules`).toBeTruthy();
      expect(text).not.toMatch(NATIVE_IMPORT);
    });
  }

  it('upload service keeps the intent → PUT → complete contract (no download-url)', () => {
    const text = readFileSync(join(process.cwd(), 'features/media/media-upload-service.ts'), 'utf8');
    expect(text).toContain('/v1/media/upload-url');
    expect(text).toContain('/complete');
    expect(text).not.toContain('download-url');
  });
});
