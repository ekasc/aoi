import type { LabelledCategory } from '@/features/face-index/labelled-dataset';

/**
 * Tooling for a private real-photo evaluation dataset.
 *
 * The dataset lives under a gitignored directory and never enters the repo.
 * This module holds the pure parts: category placement, file-name rules,
 * extension checks, and minimums. The filesystem work lives in
 * `scripts/import-private-face-eval.mjs`.
 */

export type PrivateEvalCategory = 'references-a' | 'references-b' | LabelledCategory;

export const PRIVATE_EVAL_CATEGORIES: readonly PrivateEvalCategory[] = [
  'references-a', 'references-b', 'positive', 'solo-a', 'solo-b', 'negative', 'groups',
];

export type CategoryPlacement = { folder: string; prefix: string };

/** Where a category lands inside the dataset. Reference files are prefixed a-/b-. */
export const CATEGORY_PLACEMENT: Readonly<Record<PrivateEvalCategory, CategoryPlacement>> = {
  'references-a': { folder: 'references', prefix: 'a-' },
  'references-b': { folder: 'references', prefix: 'b-' },
  positive: { folder: 'positive', prefix: '' },
  'solo-a': { folder: 'solo-a', prefix: '' },
  'solo-b': { folder: 'solo-b', prefix: '' },
  negative: { folder: 'negative', prefix: '' },
  groups: { folder: 'groups', prefix: '' },
};

/** Minimum sample sizes for a meaningful run. Negatives matter most. */
export const PRIVATE_EVAL_MINIMUMS: Readonly<Record<LabelledCategory, number>> = {
  positive: 50,
  'solo-a': 30,
  'solo-b': 30,
  negative: 75,
  groups: 50,
};

export const SUPPORTED_IMAGE_EXTENSIONS: readonly string[] = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff', '.webp'];

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

export function isSupportedImage(fileName: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.includes(extensionOf(fileName));
}

/** Strips any path separator or character that could escape the category folder. */
export function sanitizeBaseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 80) || 'photo';
}

/**
 * Destination file name for one imported photo. The default is a content-hash
 * name, so a local report never carries the original file name. `keepNames`
 * preserves the original base name for a user who wants it.
 */
export function destinationName(input: { category: PrivateEvalCategory; sha256: string; originalName: string; keepNames?: boolean }): string {
  const { prefix } = CATEGORY_PLACEMENT[input.category];
  const extension = extensionOf(input.originalName) || '.jpg';
  if (input.keepNames) return `${prefix}${sanitizeBaseName(input.originalName)}-${input.sha256.slice(0, 6)}${extension}`;
  return `${prefix}${input.sha256.slice(0, 12)}${extension}`;
}

export type MinimumReport = { category: LabelledCategory; count: number; minimum: number; met: boolean };

export function minimumReport(counts: Partial<Record<LabelledCategory, number>>): MinimumReport[] {
  return (Object.keys(PRIVATE_EVAL_MINIMUMS) as LabelledCategory[]).map((category) => {
    const count = counts[category] ?? 0;
    const minimum = PRIVATE_EVAL_MINIMUMS[category];
    return { category, count, minimum, met: count >= minimum };
  });
}

export function allMinimumsMet(report: readonly MinimumReport[]): boolean {
  return report.every((entry) => entry.met);
}
