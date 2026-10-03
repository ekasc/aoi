import type { PartnerLabel } from '@/features/face-index/types';

/**
 * Labelled local dataset for real-photo evaluation.
 *
 * The dataset is a folder the user supplies:
 *
 *   references/   a.jpg, b.jpg, or a-1.jpg, a-2.jpg, b-1.jpg, ...
 *   positive/     both people visibly present
 *   solo-a/       only partner A
 *   solo-b/       only partner B
 *   negative/     neither person
 *   groups/       group photos with zero or one enrolled person
 *
 * Labels come only from the enclosing folder. File names never imply a label.
 * The dataset stays on the machine; nothing here reads or uploads an image.
 */

export type LabelledCategory = 'positive' | 'solo-a' | 'solo-b' | 'negative' | 'groups';
export type LabelledExpectation = 'positive' | 'solo-A' | 'solo-B' | 'negative' | 'group';

export const LABELLED_CATEGORIES: Readonly<Record<LabelledCategory, LabelledExpectation>> = {
  positive: 'positive',
  'solo-a': 'solo-A',
  'solo-b': 'solo-B',
  negative: 'negative',
  groups: 'group',
};

export const LABELLED_FOLDER_NAMES = Object.keys(LABELLED_CATEGORIES) as LabelledCategory[];

export type LabelledFile = { category: LabelledCategory; expectation: LabelledExpectation; file: string };
export type ReferenceFile = { person: PartnerLabel; file: string };

/** Reads the category from the first path segment. Returns null outside a known folder. */
export function parseLabelledPath(relativePath: string): LabelledFile | null {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const folder = parts[0].toLowerCase() as LabelledCategory;
  const expectation = LABELLED_CATEGORIES[folder];
  if (!expectation) return null;
  return { category: folder, expectation, file: normalized };
}

/** `references/a.jpg` and `references/a-1.jpg` are A; `b` variants are B. */
export function parseReferencePath(relativePath: string): ReferenceFile | null {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'references') return null;
  const stem = parts[1].replace(/\.[^.]+$/, '').toLowerCase();
  if (stem === 'a' || stem.startsWith('a-')) return { person: 'A', file: normalized };
  if (stem === 'b' || stem.startsWith('b-')) return { person: 'B', file: normalized };
  return null;
}

export type LabelledDecision = 'pair' | 'unsure' | 'no-faces' | 'failed';
export type LabelledFailure = 'detector' | 'alignment' | 'embedding' | 'ambiguous-identity' | 'unattached-cluster' | 'below-cluster-threshold' | 'identity-miss';

/**
 * Everything the aggregate needs from one image. Diagnostics, not a boolean.
 */
export type LabelledOutcomeRow = {
  category: LabelledCategory;
  expectation: LabelledExpectation;
  decision: LabelledDecision;
  detectedFaces: number;
  embeddedFaces: number;
  alignmentFailures: number;
  embeddingFailures: number;
  identityAmbiguous: boolean;
  /** Some face landed in a cluster mapped to a person. */
  assignedToPerson: boolean;
  /** Some face landed in a cluster that no person claimed. */
  assignedToUnmappedCluster: boolean;
  /** Some face joined any cluster at all. */
  assignedToAnyCluster: boolean;
};

export function failureLabels(row: LabelledOutcomeRow): LabelledFailure[] {
  const labels: LabelledFailure[] = [];
  if (row.detectedFaces === 0) {
    // A detector miss is the whole story; there is no face to align or cluster.
    if (row.expectation !== 'negative') labels.push('detector');
    return labels;
  }
  if (row.alignmentFailures > 0) labels.push('alignment');
  if (row.embeddingFailures > 0) labels.push('embedding');
  if (row.decision === 'pair') return labels;
  if (row.expectation === 'positive') {
    if (row.identityAmbiguous) labels.push('ambiguous-identity');
    else if (!row.assignedToPerson && row.assignedToUnmappedCluster) labels.push('unattached-cluster');
    else if (!row.assignedToAnyCluster) labels.push('below-cluster-threshold');
    else labels.push('identity-miss');
  }
  return labels;
}

export type LabelledSummary = {
  sampleSize: { positive: number; soloA: number; soloB: number; negative: number; group: number; total: number };
  positivePairRecall: number | null;
  soloAFalsePairRate: number | null;
  soloBFalsePairRate: number | null;
  negativeFalsePairRate: number | null;
  groupFalsePairRate: number | null;
  falsePairAdditions: number;
  classification: {
    correctPair: number;
    falsePair: number;
    identityMiss: number;
    ambiguousIdentity: number;
    clusterFragmentation: number;
    detectorFailure: number;
    alignmentFailure: number;
    embeddingFailure: number;
  };
  confusion: Record<LabelledCategory, Record<LabelledDecision, number>>;
};

const rate = (numerator: number, denominator: number) => (denominator === 0 ? null : numerator / denominator);

export function summarizeLabelledOutcomes(rows: readonly LabelledOutcomeRow[]): LabelledSummary {
  const emptyDecisions = (): Record<LabelledDecision, number> => ({ pair: 0, unsure: 0, 'no-faces': 0, failed: 0 });
  const confusion = Object.fromEntries(LABELLED_FOLDER_NAMES.map((category) => [category, emptyDecisions()])) as LabelledSummary['confusion'];
  const summary: LabelledSummary = {
    sampleSize: { positive: 0, soloA: 0, soloB: 0, negative: 0, group: 0, total: rows.length },
    positivePairRecall: null,
    soloAFalsePairRate: null,
    soloBFalsePairRate: null,
    negativeFalsePairRate: null,
    groupFalsePairRate: null,
    falsePairAdditions: 0,
    classification: { correctPair: 0, falsePair: 0, identityMiss: 0, ambiguousIdentity: 0, clusterFragmentation: 0, detectorFailure: 0, alignmentFailure: 0, embeddingFailure: 0 },
    confusion,
  };

  for (const row of rows) {
    confusion[row.category][row.decision] += 1;
    const accepted = row.decision === 'pair';
    if (row.category === 'positive') summary.sampleSize.positive += 1;
    if (row.category === 'solo-a') summary.sampleSize.soloA += 1;
    if (row.category === 'solo-b') summary.sampleSize.soloB += 1;
    if (row.category === 'negative') summary.sampleSize.negative += 1;
    if (row.category === 'groups') summary.sampleSize.group += 1;

    if (row.expectation === 'positive' && accepted) summary.classification.correctPair += 1;
    if (row.expectation !== 'positive' && accepted) {
      summary.classification.falsePair += 1;
      summary.falsePairAdditions += 1;
    }
    const labels = failureLabels(row);
    if (labels.includes('detector')) summary.classification.detectorFailure += 1;
    if (labels.includes('alignment')) summary.classification.alignmentFailure += 1;
    if (labels.includes('embedding')) summary.classification.embeddingFailure += 1;
    if (labels.includes('ambiguous-identity')) summary.classification.ambiguousIdentity += 1;
    if (labels.includes('unattached-cluster')) summary.classification.clusterFragmentation += 1;
    if (labels.includes('identity-miss')) summary.classification.identityMiss += 1;
  }

  summary.positivePairRecall = rate(summary.classification.correctPair, summary.sampleSize.positive);
  summary.soloAFalsePairRate = rate(confusion['solo-a'].pair, summary.sampleSize.soloA);
  summary.soloBFalsePairRate = rate(confusion['solo-b'].pair, summary.sampleSize.soloB);
  summary.negativeFalsePairRate = rate(confusion.negative.pair, summary.sampleSize.negative);
  summary.groupFalsePairRate = rate(confusion.groups.pair, summary.sampleSize.group);
  return summary;
}
