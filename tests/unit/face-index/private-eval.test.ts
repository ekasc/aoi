import { describe, expect, it } from 'vitest';

import {
  allMinimumsMet,
  CATEGORY_PLACEMENT,
  destinationName,
  isSupportedImage,
  minimumReport,
  PRIVATE_EVAL_MINIMUMS,
  sanitizeBaseName,
} from '@/features/face-index/private-eval';

describe('private eval image filtering', () => {
  it('accepts the supported image extensions case-insensitively', () => {
    for (const name of ['a.jpg', 'a.JPEG', 'b.PNG', 'c.heic', 'd.HEIF', 'e.tif', 'f.tiff', 'g.webp']) {
      expect(isSupportedImage(name)).toBe(true);
    }
  });

  it('rejects unsupported and extensionless files', () => {
    for (const name of ['notes.txt', 'movie.mp4', 'archive.zip', 'photo', 'raw.dng']) {
      expect(isSupportedImage(name)).toBe(false);
    }
  });
});

describe('private eval destination names', () => {
  const hash = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

  it('anonymizes by default and keeps the extension', () => {
    expect(destinationName({ category: 'positive', sha256: hash, originalName: 'Our Wedding.JPG' })).toBe('abcdef012345.jpg');
    expect(destinationName({ category: 'negative', sha256: hash, originalName: 'friends.png' })).toBe('abcdef012345.png');
  });

  it('prefixes reference files so the evaluator can tell A from B', () => {
    expect(destinationName({ category: 'references-a', sha256: hash, originalName: 'a.jpg' })).toBe('a-abcdef012345.jpg');
    expect(destinationName({ category: 'references-b', sha256: hash, originalName: 'b.heic' })).toBe('b-abcdef012345.heic');
  });

  it('keeps a readable base name plus a short hash when asked', () => {
    expect(destinationName({ category: 'positive', sha256: hash, originalName: 'IMG 1234.jpeg', keepNames: true })).toBe('IMG_1234-abcdef.jpeg');
  });

  it('strips path separators and leading dots from base names', () => {
    expect(sanitizeBaseName('IMG 1234')).toBe('IMG_1234');
    expect(sanitizeBaseName('../../etc/passwd')).not.toContain('/');
    expect(sanitizeBaseName('../../etc/passwd').startsWith('.')).toBe(false);
    expect(sanitizeBaseName('.hidden').startsWith('.')).toBe(false);
  });
});

describe('private eval category placement', () => {
  it('puts both reference categories in the references folder', () => {
    expect(CATEGORY_PLACEMENT['references-a']).toEqual({ folder: 'references', prefix: 'a-' });
    expect(CATEGORY_PLACEMENT['references-b']).toEqual({ folder: 'references', prefix: 'b-' });
  });

  it('puts labelled categories in their own folders', () => {
    expect(CATEGORY_PLACEMENT.positive.folder).toBe('positive');
    expect(CATEGORY_PLACEMENT['solo-a'].folder).toBe('solo-a');
    expect(CATEGORY_PLACEMENT['solo-b'].folder).toBe('solo-b');
    expect(CATEGORY_PLACEMENT.negative.folder).toBe('negative');
    expect(CATEGORY_PLACEMENT.groups.folder).toBe('groups');
  });
});

describe('private eval minimums', () => {
  it('marks each category met or unmet against the minimum', () => {
    const report = minimumReport({ positive: 50, 'solo-a': 29, 'solo-b': 31, negative: 75, groups: 10 });
    expect(report.find((entry) => entry.category === 'positive')).toMatchObject({ met: true });
    expect(report.find((entry) => entry.category === 'solo-a')).toMatchObject({ met: false });
    expect(report.find((entry) => entry.category === 'groups')).toMatchObject({ met: false });
    expect(allMinimumsMet(report)).toBe(false);
  });

  it('treats missing categories as zero', () => {
    const report = minimumReport({});
    expect(report.every((entry) => entry.count === 0 && !entry.met)).toBe(true);
    expect(report.map((entry) => entry.minimum)).toEqual(Object.values(PRIVATE_EVAL_MINIMUMS));
  });

  it('reports all met only when every minimum is reached', () => {
    const report = minimumReport({ positive: 60, 'solo-a': 40, 'solo-b': 40, negative: 120, groups: 60 });
    expect(allMinimumsMet(report)).toBe(true);
  });
});
