import { describe, expect, it } from 'vitest';

import { datasetMetadata, failureLabels, parseLabelledPath, parseReferencePath, summarizeLabelledOutcomes, type LabelledOutcomeRow } from '@/features/face-index/labelled-dataset';

const row = (overrides: Partial<LabelledOutcomeRow>): LabelledOutcomeRow => ({
  category: 'positive',
  expectation: 'positive',
  decision: 'unsure',
  detectedFaces: 2,
  embeddedFaces: 2,
  alignmentFailures: 0,
  embeddingFailures: 0,
  identityAmbiguous: false,
  assignedToPerson: true,
  assignedToUnmappedCluster: false,
  assignedToAnyCluster: true,
  ...overrides,
});

describe('labelled path parsing', () => {
  it('takes the label from the enclosing folder only', () => {
    expect(parseLabelledPath('positive/IMG_0001.JPG')).toMatchObject({ category: 'positive', expectation: 'positive' });
    expect(parseLabelledPath('solo-a/anything.jpg')).toMatchObject({ category: 'solo-a', expectation: 'solo-A' });
    expect(parseLabelledPath('solo-b/x.png')).toMatchObject({ category: 'solo-b', expectation: 'solo-B' });
    expect(parseLabelledPath('negative/group.jpg')).toMatchObject({ category: 'negative', expectation: 'negative' });
    expect(parseLabelledPath('groups/both-together.jpg')).toMatchObject({ category: 'groups', expectation: 'group' });
  });

  it('ignores files outside a known category and does not read the filename for a label', () => {
    expect(parseLabelledPath('positive-both.jpg')).toBeNull();
    expect(parseLabelledPath('other/positive.jpg')).toBeNull();
    expect(parseLabelledPath('references/a.jpg')).toBeNull();
    expect(parseLabelledPath('positive/sub/deep.jpg')).toMatchObject({ category: 'positive' });
  });

  it('reads reference person from the a/b prefix', () => {
    expect(parseReferencePath('references/a.jpg')).toEqual({ person: 'A', file: 'references/a.jpg' });
    expect(parseReferencePath('references/a-2.PNG')).toEqual({ person: 'A', file: 'references/a-2.PNG' });
    expect(parseReferencePath('references/b-1.heic')).toEqual({ person: 'B', file: 'references/b-1.heic' });
    expect(parseReferencePath('references/c.jpg')).toBeNull();
    expect(parseReferencePath('references/sub/a.jpg')).toBeNull();
    expect(parseReferencePath('positive/a.jpg')).toBeNull();
  });
});

describe('labelled failure taxonomy', () => {
  it('separates detector, alignment, and embedding failures', () => {
    expect(failureLabels(row({ detectedFaces: 0, embeddedFaces: 0 }))).toEqual(['detector']);
    expect(failureLabels(row({ alignmentFailures: 1, embeddedFaces: 1 }))).toContain('alignment');
    expect(failureLabels(row({ embeddingFailures: 1, embeddedFaces: 1 }))).toContain('embedding');
  });

  it('separates ambiguous identity, fragmentation, and a plain identity miss', () => {
    expect(failureLabels(row({ identityAmbiguous: true, assignedToPerson: false }))).toContain('ambiguous-identity');
    expect(failureLabels(row({ assignedToPerson: false, assignedToUnmappedCluster: true }))).toContain('unattached-cluster');
    expect(failureLabels(row({ assignedToPerson: false, assignedToUnmappedCluster: false, assignedToAnyCluster: false }))).toContain('below-cluster-threshold');
    expect(failureLabels(row({ assignedToPerson: true }))).toContain('identity-miss');
  });

  it('does not label a correct pair as a failure', () => {
    expect(failureLabels(row({ decision: 'pair' }))).toEqual([]);
  });
});

describe('labelled summary', () => {
  it('reports every category separately and keeps the sample size visible', () => {
    const rows: LabelledOutcomeRow[] = [
      row({ category: 'positive', expectation: 'positive', decision: 'pair' }),
      row({ category: 'positive', expectation: 'positive', decision: 'pair' }),
      row({ category: 'positive', expectation: 'positive', decision: 'unsure' }),
      row({ category: 'solo-a', expectation: 'solo-A', decision: 'pair' }),
      row({ category: 'solo-a', expectation: 'solo-A', decision: 'unsure' }),
      row({ category: 'solo-b', expectation: 'solo-B', decision: 'unsure' }),
      row({ category: 'negative', expectation: 'negative', decision: 'pair' }),
      row({ category: 'negative', expectation: 'negative', decision: 'unsure' }),
      row({ category: 'groups', expectation: 'group', decision: 'unsure' }),
    ];
    const summary = summarizeLabelledOutcomes(rows);
    expect(summary.sampleSize).toEqual({ positive: 3, soloA: 2, soloB: 1, negative: 2, group: 1, total: 9 });
    expect(summary.positivePairRecall).toBeCloseTo(2 / 3, 6);
    expect(summary.soloAFalsePairRate).toBeCloseTo(0.5, 6);
    expect(summary.soloBFalsePairRate).toBe(0);
    expect(summary.negativeFalsePairRate).toBeCloseTo(0.5, 6);
    expect(summary.groupFalsePairRate).toBe(0);
    expect(summary.falsePairAdditions).toBe(2);
    expect(summary.classification.correctPair).toBe(2);
    expect(summary.confusion.positive).toEqual({ pair: 2, unsure: 1, 'no-faces': 0, failed: 0 });
  });

  it('reports a null rate when a category has no samples rather than a fake zero', () => {
    const summary = summarizeLabelledOutcomes([row({ category: 'positive', expectation: 'positive', decision: 'pair' })]);
    expect(summary.soloAFalsePairRate).toBeNull();
    expect(summary.negativeFalsePairRate).toBeNull();
    expect(summary.groupFalsePairRate).toBeNull();
  });
});

describe('report metadata privacy', () => {
  it('never persists the absolute dataset root', () => {
    const entries = [parseLabelledPath('positive/a.jpg'), parseLabelledPath('negative/b.jpg')].filter((entry) => entry !== null);
    const metadata = datasetMetadata({
      root: '/Users/someone/private-photos/our-couple-dataset',
      entries,
      references: { A: ['references/a.jpg'], B: ['references/b-1.jpg', 'references/b-2.jpg'] },
      corpus: 'all',
    });
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain('/Users/someone/private-photos/our-couple-dataset');
    expect(serialized).not.toContain('/Users/');
    expect(metadata).toEqual({
      corpus: 'all',
      labelledPhotos: 2,
      references: { A: 1, B: 2 },
      categories: { positive: 1, 'solo-a': 0, 'solo-b': 0, negative: 1, groups: 0 },
    });
  });
});
