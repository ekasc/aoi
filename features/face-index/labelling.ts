import type { LabelledCategory } from '@/features/face-index/labelled-dataset';
import {
  CATEGORY_PLACEMENT,
  destinationName,
  minimumReport,
  type MinimumReport,
  type PrivateEvalCategory,
} from '@/features/face-index/private-eval';

/**
 * Local labelling state and dataset validation for the private real-photo eval.
 *
 * The state file lives under gitignored `.expo/face-lab/` and may hold the
 * absolute source root so a session can resume. That absolute path is allowed
 * only in this private state, never in a report or a committed document.
 *
 * Everything here is pure: no filesystem, no HTTP, no embeddings.
 */

export type ReferencePerson = 'A' | 'B';

export type LabellingAssignment =
  | { kind: 'category'; category: LabelledCategory }
  | { kind: 'reference'; person: ReferencePerson };

export type LabellingSample = {
  /** Content hash. The dedupe key and the dataset file name. */
  id: string;
  /** Path relative to the source root. */
  source: string;
  bytes: number;
  mtimeMs: number;
  assignment: LabellingAssignment | null;
  /** Relative path inside the dataset once applied. Null when unassigned. */
  dest: string | null;
  updatedAt: string | null;
};

export type LabellingState = {
  version: 1;
  /** Absolute source root. Private state only, gitignored. */
  sourceRoot: string;
  createdAt: string;
  updatedAt: string;
  /** Files skipped because their content already had a sample. */
  duplicateCount: number;
  samples: LabellingSample[];
};

export const LABELLING_STATE_VERSION = 1;
export const DEFAULT_SAMPLE_SEED = 1;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function assignmentToPrivateCategory(assignment: LabellingAssignment): PrivateEvalCategory {
  if (assignment.kind === 'reference') return assignment.person === 'A' ? 'references-a' : 'references-b';
  return assignment.category;
}

/** Dataset folder and anonymized file name for one assignment. */
export function datasetDestination(input: { assignment: LabellingAssignment; hash: string; source: string }): { folder: string; name: string } {
  const category = assignmentToPrivateCategory(input.assignment);
  const { folder } = CATEGORY_PLACEMENT[category];
  return { folder, name: destinationName({ category, sha256: input.hash, originalName: input.source }) };
}

export function createLabellingState(input: { sourceRoot: string; samples: LabellingSample[]; now: string; duplicateCount?: number }): LabellingState {
  return {
    version: LABELLING_STATE_VERSION,
    sourceRoot: input.sourceRoot,
    createdAt: input.now,
    updatedAt: input.now,
    duplicateCount: input.duplicateCount ?? 0,
    samples: input.samples,
  };
}

function parseAssignment(value: unknown): LabellingAssignment | null {
  if (!isObject(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'reference' && (value.person === 'A' || value.person === 'B')) return { kind: 'reference', person: value.person };
  if (value.kind === 'category' && typeof value.category === 'string') return { kind: 'category', category: value.category as LabelledCategory };
  return null;
}

export function parseLabellingState(value: unknown): LabellingState | null {
  if (!isObject(value) || value.version !== LABELLING_STATE_VERSION || typeof value.sourceRoot !== 'string' || !Array.isArray(value.samples)) return null;
  const samples: LabellingSample[] = [];
  for (const raw of value.samples) {
    if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.source !== 'string' || !raw.source) return null;
    samples.push({
      id: raw.id,
      source: raw.source,
      bytes: typeof raw.bytes === 'number' && Number.isFinite(raw.bytes) ? raw.bytes : 0,
      mtimeMs: typeof raw.mtimeMs === 'number' && Number.isFinite(raw.mtimeMs) ? raw.mtimeMs : 0,
      assignment: parseAssignment(raw.assignment),
      dest: typeof raw.dest === 'string' ? raw.dest : null,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    });
  }
  return {
    version: LABELLING_STATE_VERSION,
    sourceRoot: value.sourceRoot,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    duplicateCount: typeof value.duplicateCount === 'number' && Number.isFinite(value.duplicateCount) ? value.duplicateCount : 0,
    samples,
  };
}

/** Immutable update of one sample's assignment and dataset path. Returns a new state. */
export function applyAssignment(state: LabellingState, id: string, assignment: LabellingAssignment | null, now: string, dest: string | null = null): LabellingState {
  return {
    ...state,
    updatedAt: now,
    samples: state.samples.map((sample) => (sample.id === id ? { ...sample, assignment, dest, updatedAt: now } : sample)),
  };
}

export type LabellingCounts = {
  total: number;
  unlabelled: number;
  categories: Record<LabelledCategory, number>;
  referencesA: number;
  referencesB: number;
};

export function labellingCounts(state: LabellingState): LabellingCounts {
  const categories: Record<LabelledCategory, number> = { positive: 0, 'solo-a': 0, 'solo-b': 0, negative: 0, groups: 0 };
  let unlabelled = 0;
  let referencesA = 0;
  let referencesB = 0;
  for (const sample of state.samples) {
    if (!sample.assignment) { unlabelled += 1; continue; }
    if (sample.assignment.kind === 'reference') {
      if (sample.assignment.person === 'A') referencesA += 1; else referencesB += 1;
    } else {
      categories[sample.assignment.category] += 1;
    }
  }
  return { total: state.samples.length, unlabelled, categories, referencesA, referencesB };
}

/** Deterministic 32-bit PRNG. Same seed, same order, on every machine. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

/**
 * Deterministic sample selection. `spread` picks evenly across a date-sorted
 * list so the first test is not 300 adjacent photos. Otherwise a seeded shuffle
 * picks the subset. No model and no content heuristic is involved.
 */
export function selectSamples<T extends { mtimeMs: number }>(items: readonly T[], options: { limit?: number; seed?: number; spread?: boolean }): T[] {
  const { limit, seed = DEFAULT_SAMPLE_SEED, spread = false } = options;
  if (!limit || limit <= 0 || items.length <= limit) return [...items];
  if (spread) {
    const byDate = [...items].sort((left, right) => left.mtimeMs - right.mtimeMs);
    const selected: T[] = [];
    for (let index = 0; index < limit; index += 1) {
      const position = Math.round((index * (byDate.length - 1)) / (limit - 1));
      selected.push(byDate[position]);
    }
    return selected;
  }
  const selected = seededShuffle(items, seed).slice(0, limit);
  return items.filter((item) => selected.includes(item));
}

export type DatasetEntry = { folder: string; name: string; hash: string };

export type DatasetValidation = {
  counts: Record<PrivateEvalCategory, number>;
  unlabelled: number;
  duplicates: { hash: string; locations: string[] }[];
  leakage: { hash: string; reference: string; evaluation: string }[];
  minimums: MinimumReport[];
  warnings: string[];
};

const REFERENCE_FOLDERS = new Set(['references']);
const EVALUATION_FOLDERS = new Set(['positive', 'solo-a', 'solo-b', 'negative', 'groups']);

/**
 * Check the dataset on disk plus the labelling state. Detects duplicate content
 * across categories and any content that is both a reference and an evaluation
 * photo, which would leak enrollment into the test.
 */
export function validateDataset(input: { entries: readonly DatasetEntry[]; state: LabellingState | null }): DatasetValidation {
  const counts: Record<PrivateEvalCategory, number> = { 'references-a': 0, 'references-b': 0, positive: 0, 'solo-a': 0, 'solo-b': 0, negative: 0, groups: 0 };
  const locations = new Map<string, string[]>();
  for (const entry of input.entries) {
    const location = `${entry.folder}/${entry.name}`;
    const existing = locations.get(entry.hash);
    if (existing) existing.push(location); else locations.set(entry.hash, [location]);
    if (entry.folder === 'references') {
      if (entry.name.startsWith('a-')) counts['references-a'] += 1;
      else if (entry.name.startsWith('b-')) counts['references-b'] += 1;
    } else if (entry.folder in counts) {
      counts[entry.folder as PrivateEvalCategory] += 1;
    }
  }

  const duplicates = [...locations.entries()].filter(([, list]) => list.length > 1).map(([hash, list]) => ({ hash, locations: list }));
  const leakage = [...locations.entries()].flatMap(([hash, list]) => {
    const reference = list.find((location) => REFERENCE_FOLDERS.has(location.split('/')[0]));
    const evaluation = list.find((location) => EVALUATION_FOLDERS.has(location.split('/')[0]));
    return reference && evaluation ? [{ hash, reference, evaluation }] : [];
  });

  const categoryCounts: Partial<Record<LabelledCategory, number>> = {
    positive: counts.positive, 'solo-a': counts['solo-a'], 'solo-b': counts['solo-b'], negative: counts.negative, groups: counts.groups,
  };
  const minimums = minimumReport(categoryCounts);
  const warnings: string[] = [];
  for (const entry of minimums) if (!entry.met) warnings.push(`${entry.category}: ${entry.count}/${entry.minimum}`);
  if (counts['references-a'] < 3) warnings.push(`references A: ${counts['references-a']}/3`);
  if (counts['references-b'] < 3) warnings.push(`references B: ${counts['references-b']}/3`);
  for (const item of leakage) warnings.push(`leakage: ${item.hash.slice(0, 8)} is both ${item.reference} and ${item.evaluation}`);
  for (const item of duplicates) warnings.push(`duplicate: ${item.hash.slice(0, 8)} at ${item.locations.join(', ')}`);

  return { counts, unlabelled: input.state ? labellingCounts(input.state).unlabelled : 0, duplicates, leakage, minimums, warnings };
}
