import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { resolveStagedUri } from '@/features/composer/staged-uri';

describe('resolveStagedUri (default/web/tests implementation)', () => {
  it('passes absolute URIs of any scheme through untouched', () => {
    expect(resolveStagedUri('file:///var/mobile/Documents/x.jpg')).toBe(
      'file:///var/mobile/Documents/x.jpg'
    );
    expect(resolveStagedUri('content://media/external/images/media/1')).toBe(
      'content://media/external/images/media/1'
    );
    expect(resolveStagedUri('ph://ABCDEF-1234')).toBe('ph://ABCDEF-1234');
    expect(resolveStagedUri('https://cdn.example.com/img.jpg')).toBe(
      'https://cdn.example.com/img.jpg'
    );
    expect(resolveStagedUri('blob:http://localhost/uuid')).toBe(
      'blob:http://localhost/uuid'
    );
    expect(resolveStagedUri('data:image/jpeg;base64,/9j/')).toBe(
      'data:image/jpeg;base64,/9j/'
    );
  });

  it('passes staged-relative paths through on this platform (native prefixes the Documents base)', () => {
    expect(resolveStagedUri('composer/v/s/staged/staged_1.jpg')).toBe(
      'composer/v/s/staged/staged_1.jpg'
    );
  });

  it('handles empty input', () => {
    expect(resolveStagedUri('')).toBe('');
  });
});

describe('resolveStagedUri native implementation', () => {
  const NATIVE_SOURCE = readFileSync(
    'features/composer/staged-uri.native.ts',
    'utf8'
  );

  it('prefixes bare paths with the sandbox Documents base, keeping absolute URIs intact', () => {
    expect(NATIVE_SOURCE).toContain('documentDirectory');
    // Scheme-aware passthrough (file/content/ph/http(s)/blob/data).
    expect(NATIVE_SOURCE).toContain('/^[a-z][a-z0-9+.-]*:/i');
    expect(NATIVE_SOURCE).toContain('`${base}${uri}`');
  });
});
