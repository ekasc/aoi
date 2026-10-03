import { describe, expect, it } from 'vitest';

import {
  applyAssignment,
  assignmentToPrivateCategory,
  createLabellingState,
  datasetDestination,
  labellingCounts,
  parseLabellingState,
  seededShuffle,
  selectSamples,
  validateDataset,
  type LabellingSample,
  type LabellingState,
} from '@/features/face-index/labelling';

const hash = (value: string) => value.padEnd(64, '0').slice(0, 64);

function sample(id: string, overrides: Partial<LabellingSample> = {}): LabellingSample {
  return { id, source: `photos/${id}.jpg`, bytes: 100, mtimeMs: 0, assignment: null, dest: null, updatedAt: null, ...overrides };
}

describe('labelling assignment placement', () => {
  it('maps categories to themselves and references to their prefixed folders', () => {
    expect(assignmentToPrivateCategory({ kind: 'category', category: 'positive' })).toBe('positive');
    expect(assignmentToPrivateCategory({ kind: 'reference', person: 'A' })).toBe('references-a');
    expect(assignmentToPrivateCategory({ kind: 'reference', person: 'B' })).toBe('references-b');
  });

  it('builds an anonymized dataset destination', () => {
    expect(datasetDestination({ assignment: { kind: 'category', category: 'negative' }, hash: hash('abcdef'), source: 'IMG 1.jpg' }))
      .toEqual({ folder: 'negative', name: 'abcdef000000.jpg' });
    expect(datasetDestination({ assignment: { kind: 'reference', person: 'B' }, hash: hash('123456'), source: 'b.heic' }))
      .toEqual({ folder: 'references', name: 'b-123456000000.heic' });
  });
});

describe('labelling state', () => {
  it('round-trips through parse', () => {
    const state = createLabellingState({ sourceRoot: '/tmp/photos', now: '2026-01-01T00:00:00Z', samples: [sample(hash('a'), { assignment: { kind: 'category', category: 'positive' } })] });
    const parsed = parseLabellingState(JSON.parse(JSON.stringify(state)));
    expect(parsed).toEqual(state);
  });

  it('rejects malformed state instead of trusting it', () => {
    expect(parseLabellingState(null)).toBeNull();
    expect(parseLabellingState({ version: 2, sourceRoot: '/x', samples: [] })).toBeNull();
    expect(parseLabellingState({ version: 1, sourceRoot: '/x', samples: [{ id: '' }] })).toBeNull();
  });

  it('updates one sample immutably, records the dataset path, and can clear it', () => {
    const state = createLabellingState({ sourceRoot: '/tmp', now: 't0', samples: [sample(hash('a')), sample(hash('b'))] });
    const labelled = applyAssignment(state, hash('a'), { kind: 'reference', person: 'A' }, 't1', 'references/a-x.jpg');
    expect(state.samples[0].assignment).toBeNull();
    expect(labelled.samples[0].assignment).toEqual({ kind: 'reference', person: 'A' });
    expect(labelled.samples[0].dest).toBe('references/a-x.jpg');
    expect(labelled.samples[0].updatedAt).toBe('t1');
    const cleared = applyAssignment(labelled, hash('a'), null, 't2');
    expect(cleared.samples[0].assignment).toBeNull();
    expect(cleared.samples[0].dest).toBeNull();
  });

  it('counts categories, references, and unlabelled photos', () => {
    const state = createLabellingState({ sourceRoot: '/tmp', now: 't0', samples: [
      sample(hash('a'), { assignment: { kind: 'category', category: 'positive' } }),
      sample(hash('b'), { assignment: { kind: 'category', category: 'negative' } }),
      sample(hash('c'), { assignment: { kind: 'reference', person: 'A' } }),
      sample(hash('d'), { assignment: { kind: 'reference', person: 'B' } }),
      sample(hash('e')),
    ] });
    expect(labellingCounts(state)).toEqual({
      total: 5,
      unlabelled: 1,
      categories: { positive: 1, 'solo-a': 0, 'solo-b': 0, negative: 1, groups: 0 },
      referencesA: 1,
      referencesB: 1,
    });
  });
});

describe('deterministic sampling', () => {
  const items = Array.from({ length: 10 }, (_, index) => ({ id: `p${index}`, mtimeMs: index }));

  it('returns everything when the limit is not smaller than the input', () => {
    expect(selectSamples(items, { limit: 20 })).toEqual(items);
    expect(selectSamples(items, {})).toEqual(items);
  });

  it('seeded shuffle is stable for one seed and different for another', () => {
    expect(seededShuffle(items, 1)).toEqual(seededShuffle(items, 1));
    expect(seededShuffle(items, 1)).not.toEqual(seededShuffle(items, 2));
  });

  it('spreads the selection evenly across capture dates', () => {
    const selected = selectSamples(items, { limit: 5, spread: true });
    expect(selected.map((item) => item.id)).toEqual(['p0', 'p2', 'p5', 'p7', 'p9']);
  });

  it('keeps the sampled subset in input order for the shuffle path', () => {
    const selected = selectSamples(items, { limit: 4, seed: 3 });
    expect(selected).toHaveLength(4);
    const positions = selected.map((item) => Number(item.id.slice(1)));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });
});

describe('dataset validation', () => {
  it('counts categories and references', () => {
    const validation = validateDataset({ entries: [
      { folder: 'references', name: 'a-1.jpg', hash: hash('r1') },
      { folder: 'references', name: 'b-1.jpg', hash: hash('r2') },
      { folder: 'positive', name: 'p.jpg', hash: hash('p1') },
      { folder: 'groups', name: 'g.jpg', hash: hash('g1') },
    ], state: null });
    expect(validation.counts).toMatchObject({ 'references-a': 1, 'references-b': 1, positive: 1, groups: 1, negative: 0 });
    expect(validation.duplicates).toEqual([]);
    expect(validation.leakage).toEqual([]);
  });

  it('detects duplicate content across categories', () => {
    const validation = validateDataset({ entries: [
      { folder: 'positive', name: 'p.jpg', hash: hash('same') },
      { folder: 'negative', name: 'n.jpg', hash: hash('same') },
    ], state: null });
    expect(validation.duplicates).toHaveLength(1);
    expect(validation.warnings.some((warning) => warning.startsWith('duplicate:'))).toBe(true);
  });

  it('detects reference content that also sits in an evaluation category', () => {
    const validation = validateDataset({ entries: [
      { folder: 'references', name: 'a-leak.jpg', hash: hash('leak') },
      { folder: 'positive', name: 'leak.jpg', hash: hash('leak') },
    ], state: null });
    expect(validation.leakage).toHaveLength(1);
    expect(validation.leakage[0]).toMatchObject({ hash: hash('leak'), reference: 'references/a-leak.jpg', evaluation: 'positive/leak.jpg' });
  });

  it('reports unlabelled samples from the saved session', () => {
    const state: LabellingState = createLabellingState({ sourceRoot: '/tmp', now: 't0', samples: [sample(hash('a')), sample(hash('b'), { assignment: { kind: 'category', category: 'positive' } })] });
    expect(validateDataset({ entries: [], state }).unlabelled).toBe(1);
  });

  it('warns when minimums or references are short, without blocking', () => {
    const validation = validateDataset({ entries: [{ folder: 'positive', name: 'p.jpg', hash: hash('p1') }], state: null });
    expect(validation.warnings.some((warning) => warning.startsWith('positive:'))).toBe(true);
    expect(validation.warnings.some((warning) => warning.startsWith('references A:'))).toBe(true);
    expect(validation.warnings.some((warning) => warning.startsWith('references B:'))).toBe(true);
  });
});
