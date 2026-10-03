import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createMacFaceEngine, loadAppModules } from './face-eval-engine.mjs';

const root = resolve('.expo/face-benchmark/ava-active-speaker');
loadAppModules();
const { fitFaceAlignment } = await import('../features/album/face-alignment.ts');
const { DEFAULT_MATCH_THRESHOLD, matchPairByCosine, cosineSimilarity } = await import('../features/album/face-pipeline.ts');
const { createIndexedFace } = await import('../features/face-index/embedding.ts');
const { createFaceClusterer, SPIKE_CLUSTER_OPTIONS } = await import('../features/face-index/clusterer.ts');
const { identifyPartnerClustersWithEvidence, identityByCluster, IDENTITY_STRATEGIES, SPIKE_IDENTIFICATION_OPTIONS } = await import('../features/face-index/identify.ts');
const { findCouplePhotos } = await import('../features/face-index/pair-query.ts');
const { matchAnnotatedFaces } = await import('../features/face-index/ava-ground-truth.ts');
const categories = ['positive', 'solo-a', 'solo-b', 'groups', 'negative'];
assert.equal(DEFAULT_MATCH_THRESHOLD, 0.72);

function label(entities, a, b) {
  const ids = Object.keys(entities);
  if (ids.includes(a) && ids.includes(b)) return 'positive';
  if (ids.includes(a)) return ids.length === 1 ? 'solo-a' : 'groups';
  if (ids.includes(b)) return ids.length === 1 ? 'solo-b' : 'groups';
  return 'negative';
}

function summary(rows) {
  const byCategory = Object.fromEntries(categories.map((category) => {
    const selected = rows.filter((row) => row.category === category);
    return [category, { total: selected.length, pairs: selected.filter((row) => row.decision === 'pair').length }];
  }));
  const positive = byCategory.positive;
  const negative = Object.entries(byCategory).filter(([key]) => key !== 'positive').map(([, value]) => value);
  const falsePairs = negative.reduce((sum, row) => sum + row.pairs, 0);
  const nonpositive = negative.reduce((sum, row) => sum + row.total, 0);
  return { byCategory, found: positive.pairs, positives: positive.total,
    recall: positive.total ? positive.pairs / positive.total : null,
    falsePairs, nonpositive, falsePairRate: nonpositive ? falsePairs / nonpositive : null };
}

function aggregate(runs) {
  const pooled = summary(runs.flatMap((run) => run.rows));
  const valid = runs.map((run) => run.metrics).filter((row) => row.recall !== null);
  const negative = runs.map((run) => run.metrics).filter((row) => row.falsePairRate !== null);
  return { ...pooled, macroRecall: valid.length ? valid.reduce((sum, row) => sum + row.recall, 0) / valid.length : null,
    macroFalsePairRate: negative.length ? negative.reduce((sum, row) => sum + row.falsePairRate, 0) / negative.length : null,
    ambiguousPairs: runs.filter((run) => run.ambiguous).length,
    contestedClusters: runs.reduce((sum, run) => sum + (run.contested ?? 0), 0),
    clusterCount: runs.reduce((sum, run) => sum + (run.clusterCount ?? 0), 0) };
}

function pipelineFailure(pair, result) {
  const a = result.targets[pair.a]; const b = result.targets[pair.b];
  if (!a && !b) return 'both detector miss';
  if (!a) return 'A detector miss';
  if (!b) return 'B detector miss';
  for (const [person, target] of [['A', a], ['B', b]]) {
    if (target.stage === 'alignment-failed') return `${person} alignment failure`;
  }
  for (const [person, target] of [['A', a], ['B', b]]) {
    if (target.stage === 'embedding-failed') return `${person} embedding failure`;
  }
  return null;
}

const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
assert(manifest.pairs.length > 0);
for (const pair of manifest.pairs) {
  assert.notEqual(pair.a, pair.b);
  assert(pair.references.length >= 3);
  assert(Math.min(...pair.queries) - Math.max(...pair.references) >= manifest.minimumGapMs);
  const referenceHashes = new Set(pair.references.map((t) => pair.frames[t].sha256));
  const queryHashes = new Set();
  let previous = -Infinity;
  for (const t of pair.queries) {
    assert(t - previous >= manifest.spacingMs); previous = t;
    assert(!pair.references.includes(t));
    const record = pair.frames[t];
    assert(!referenceHashes.has(record.sha256));
    assert(!queryHashes.has(record.sha256)); queryHashes.add(record.sha256);
    assert(pair.categories[label(record.entities, pair.a, pair.b)].includes(t));
  }
}
const handle = await createMacFaceEngine();
const results = new Map();
const cacheDirectory = join(root, 'embeddings');
await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
try {
  let processed = 0;
  for (const pair of manifest.pairs) {
    for (const timestamp of [...pair.references, ...pair.queries]) {
      const record = pair.frames[timestamp];
      if (results.has(record.file)) continue;
      const bytes = await readFile(join(root, record.file));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
      const key = createHash('sha256').update(`${record.sha256}:${handle.engine.modelId}:ava-iou0.3-v1:${JSON.stringify(record.entities)}`).digest('hex');
      const cache = join(cacheDirectory, key + '.json');
      let result;
      try { result = JSON.parse(await readFile(cache, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (result) {
        result.faces.forEach((face) => {
          face.embedding = Float32Array.from(face.embedding);
          face.faceId = `${record.file}#${face.detectionIndex}`;
          face.assetId = record.file;
        });
        Object.values(result.targets).forEach((target) => { target.faceId = `${record.file}#${target.detectionIndex}`; });
      } else {
        const uri = pathToFileURL(join(root, record.file)).href;
        let detections = []; let detectionError = false;
        try { detections = await handle.engine.detect(uri); }
        catch { detectionError = true; }
        const annotations = Object.entries(record.entities).map(([entity, box]) => ({ entity,
          box: { x: box[0] * record.width, y: box[1] * record.height,
            width: (box[2] - box[0]) * record.width, height: (box[3] - box[1]) * record.height } }));
        const matched = matchAnnotatedFaces(annotations, detections);
        const entityByDetection = new Map([...matched].map(([entity, index]) => [index, entity]));
        const stages = []; const faces = [];
        for (const [index, face] of detections.entries()) {
          if (!face.landmarks || !fitFaceAlignment(face.landmarks)) { stages[index] = 'alignment-failed'; continue; }
          try {
            const embedding = await handle.engine.embed(uri, face);
            const indexed = createIndexedFace({ faceId: `${record.file}#${index}`, assetId: record.file, embedding,
              detectionScore: typeof face.captureQuality === 'number' ? face.captureQuality : 1,
              qualityScore: Math.max(0, Math.min(1, Math.min(face.width, face.height) / 112)) });
            if (!indexed) { stages[index] = 'embedding-failed'; continue; }
            faces.push({ ...indexed, detectionIndex: index, annotatedEntity: entityByDetection.get(index) ?? null });
            stages[index] = 'embedded';
          } catch { stages[index] = 'embedding-failed'; }
        }
        result = { faces, detections: detections.map(({ x, y, width, height }) => ({ x, y, width, height })), detectionError,
          targets: Object.fromEntries([...matched].map(([entity, index]) => [entity,
            { detectionIndex: index, faceId: `${record.file}#${index}`, stage: stages[index] }])) };
        await writeFile(cache, JSON.stringify({ ...result, faces: faces.map((face) => ({ ...face, embedding: Array.from(face.embedding) })) }), { mode: 0o600 });
      }
      results.set(record.file, result);
      processed += 1;
      if (processed % 20 === 0) console.log('Processed', processed, 'full frames');
    }
  }
} finally { await handle.close(); }

const report = { configuration: { baselineThreshold: DEFAULT_MATCH_THRESHOLD, cluster: SPIKE_CLUSTER_OPTIONS,
  identification: SPIKE_IDENTIFICATION_OPTIONS, primary: 'top-k', detectorIoU: 0.3 }, pairs: [] };
for (const pair of manifest.pairs) {
  const get = (timestamp) => results.get(pair.frames[timestamp].file);
  const referenceFaces = ['a', 'b'].map((person) => pair.references.flatMap((t) => {
    const result = get(t); const target = result.targets[pair[person]];
    return target?.stage === 'embedded' ? result.faces.filter((face) => face.faceId === target.faceId) : [];
  }));
  const enrollment = { A: referenceFaces[0].map((face) => face.embedding), B: referenceFaces[1].map((face) => face.embedding) };
  const queries = pair.queries.map((timestamp) => ({ timestamp, record: pair.frames[timestamp], result: get(timestamp),
    category: label(pair.frames[timestamp].entities, pair.a, pair.b) }));
  const prints = [...enrollment.A.map((embedding) => ({ person: 'you', embedding })),
    ...enrollment.B.map((embedding) => ({ person: 'partner', embedding }))];
  const baselineRows = queries.map(({ timestamp, category, result }) => {
    const decision = matchPairByCosine(result.faces.map((face) => face.embedding), prints, DEFAULT_MATCH_THRESHOLD);
    return { timestamp, category, decision: decision.kind === 'pair' ? 'pair' : 'not-pair',
      groundTruthEntities: Object.keys(pair.frames[timestamp].entities), detections: result.detections,
      faces: result.faces.map((face) => ({ faceId: face.faceId, annotatedEntity: face.annotatedEntity,
        A: enrollment.A.map((ref) => cosineSimilarity(face.embedding, ref)),
        B: enrollment.B.map((ref) => cosineSimilarity(face.embedding, ref)) })),
      failure: category === 'positive' && decision.kind !== 'pair' ? pipelineFailure(pair, result) ?? 'unresolved' : null,
      targetReferenceSimilarities: Object.fromEntries(['a', 'b'].map((person, index) => {
        const target = result.faces.find((face) => face.faceId === result.targets[pair[person]]?.faceId);
        return [person, target ? referenceFaces[index].map((ref) => cosineSimilarity(target.embedding, ref.embedding)) : []];
      })) };
  });
  const detector = { targets: 0, detected: 0, aligned: 0, embedded: 0, positives: 0,
    both: 0, onlyA: 0, onlyB: 0, neither: 0, detectionErrors: 0 };
  for (const { category, result } of queries) {
    if (result.detectionError) detector.detectionErrors += 1;
    if (category !== 'positive') continue;
    detector.positives += 1; detector.targets += 2;
    const a = result.targets[pair.a]; const b = result.targets[pair.b];
    if (a && b) detector.both += 1;
    else if (a) detector.onlyA += 1;
    else if (b) detector.onlyB += 1;
    else detector.neither += 1;
    for (const target of [a, b]) {
      if (!target) continue;
      detector.detected += 1;
      if (target.stage !== 'alignment-failed') detector.aligned += 1;
      if (target.stage === 'embedded') detector.embedded += 1;
    }
  }
  const runs = [];
  for (const corpus of ['references', 'all']) {
    for (const threshold of [0.4, 0.5, 0.55, 0.65, 0.75]) {
      const clusterer = createFaceClusterer({ ...SPIKE_CLUSTER_OPTIONS, similarityThreshold: threshold,
        lowQualityThreshold: Math.max(SPIKE_CLUSTER_OPTIONS.lowQualityThreshold, threshold) });
      const timestamps = corpus === 'all' ? [...pair.references, ...pair.queries] : pair.references;
      const faces = timestamps.flatMap((t) => get(t).faces).sort((a, b) => a.faceId.localeCompare(b.faceId));
      for (const face of faces) clusterer.assign(face);
      const clusters = clusterer.clusters();
      for (const strategy of threshold === SPIKE_CLUSTER_OPTIONS.similarityThreshold ? IDENTITY_STRATEGIES : ['top-k']) {
        const { identification, evidence } = identifyPartnerClustersWithEvidence(clusters, enrollment,
          { ...SPIKE_IDENTIFICATION_OPTIONS, strategy });
        const mapping = identityByCluster(identification);
        const faceById = new Map(faces.map((face) => [face.faceId, face]));
        const annotatedClusterMembers = new Map(clusters.map((cluster) => [cluster.clusterId,
          [...new Set(cluster.faceIds.map((faceId) => faceById.get(faceId)?.annotatedEntity).filter(Boolean))]]));
        const rows = queries.map(({ timestamp, record, category, result }) => {
          const assignments = new Map();
          for (const face of result.faces) {
            const assignment = clusterer.assignmentFor(face.faceId) ?? clusterer.classify(face);
            if (assignment) assignments.set(face.faceId, { ...assignment, assetId: face.assetId });
          }
          const [decision] = findCouplePhotos({ assets: [{ assetId: record.file, faces: result.faces }],
            assignments, identityByCluster: mapping });
          let failure = null;
          if (category === 'positive' && decision.decision !== 'pair') {
            failure = pipelineFailure(pair, result);
            if (!failure) {
              if (identification.kind !== 'identified') failure = 'identity ambiguity';
              else {
                const targetAssignments = [pair.a, pair.b].map((entity) => assignments.get(result.targets[entity]?.faceId));
                const identities = targetAssignments.map((assignment) => assignment ? mapping.get(assignment.clusterId) : undefined);
                if (identities[0] === 'B' || identities[1] === 'A') failure = 'wrong identity attachment';
                else if (identities[0] === 'A' && identities[1] === 'B') failure = 'pair-query failure';
                else if (targetAssignments.some((assignment) => assignment && !mapping.has(assignment.clusterId))) failure = 'identity unattached';
                else failure = 'unresolved';
              }
            }
          }
          return { timestamp, category, decision: decision.decision, queryReason: decision.reason, failure,
            groundTruthEntities: Object.keys(record.entities), detections: result.detections,
            faces: result.faces.map((face) => {
              const assignment = assignments.get(face.faceId);
              return { faceId: face.faceId, annotatedEntity: face.annotatedEntity, clusterId: assignment?.clusterId ?? null,
                similarity: assignment?.similarity ?? null, person: assignment ? mapping.get(assignment.clusterId) ?? null : null };
            }),
            falsePairCause: category !== 'positive' && decision.decision === 'pair' ? 'annotation limitation / unresolved' : null };
        });
        const attachedA = evidence.filter((item) => item.attachedTo === 'A').length;
        const attachedB = evidence.filter((item) => item.attachedTo === 'B').length;
        runs.push({ corpus, threshold, strategy, metrics: summary(rows), rows,
          evidence: evidence.map((item) => ({ ...item, annotatedMemberTrackIds: annotatedClusterMembers.get(item.clusterId) })),
          identification: identification.kind, identificationReason: identification.reason ?? null, ambiguous: identification.kind !== 'identified',
          attachedA, attachedB, contested: evidence.filter((item) => item.sharedClaim).length, clusterCount: clusters.length });
      }
    }
  }
  const sensitivities = [1, 3, 5].map((seconds) => {
    const selected = []; let last = -Infinity;
    for (const query of queries) {
      if (query.timestamp - last >= seconds * 1000) { selected.push(query.timestamp); last = query.timestamp; }
    }
    return { spacingSeconds: seconds, baseline: summary(baselineRows.filter((row) => selected.includes(row.timestamp))),
      cluster: Object.fromEntries(['references', 'all'].map((corpus) => [corpus,
        summary(runs.find((run) => run.corpus === corpus && run.strategy === 'top-k' && run.threshold === 0.55).rows.filter((row) => selected.includes(row.timestamp)))])) };
  });
  const timeGaps = queries.map((query) => ({ timestamp: query.timestamp,
    seconds: (query.timestamp - Math.max(...pair.references)) / 1000 }));
  report.pairs.push({ pairId: pair.pairId, video: pair.video, gapSeconds: pair.gapSeconds,
    referenceCounts: { selectedA: pair.references.length, selectedB: pair.references.length,
      embeddedA: enrollment.A.length, embeddedB: enrollment.B.length },
    detector, baseline: { metrics: summary(baselineRows), rows: baselineRows }, runs, sensitivities, timeGaps });
}
report.baseline = aggregate(report.pairs.map((pair) => pair.baseline));
report.configurations = [];
for (const corpus of ['references', 'all']) {
  for (const threshold of [0.4, 0.5, 0.55, 0.65, 0.75]) {
    for (const strategy of threshold === 0.55 ? IDENTITY_STRATEGIES : ['top-k']) {
      const runs = report.pairs.map((pair) => pair.runs.find((run) => run.corpus === corpus && run.threshold === threshold && run.strategy === strategy));
      const comparison = { improved: 0, tied: 0, regressed: 0 };
      report.pairs.forEach((pair, index) => {
        const difference = runs[index].metrics.found - pair.baseline.metrics.found;
        comparison[difference > 0 ? 'improved' : difference < 0 ? 'regressed' : 'tied'] += 1;
      });
      report.configurations.push({ corpus, threshold, strategy, ...aggregate(runs), ...comparison });
    }
  }
}
report.detector = Object.fromEntries(Object.keys(report.pairs[0].detector).map((key) =>
  [key, report.pairs.reduce((sum, pair) => sum + pair.detector[key], 0)]));
report.analysis = {};
for (const corpus of ['references', 'all']) {
  const runs = report.pairs.map((pair) => pair.runs.find((run) => run.corpus === corpus && run.threshold === 0.55 && run.strategy === 'top-k'));
  const failures = {};
  for (const run of runs) for (const row of run.rows) if (row.failure) failures[row.failure] = (failures[row.failure] ?? 0) + 1;
  const bias = {};
  for (const strategy of ['member-support', 'top-k', 'representative', 'majority-vote']) {
    const bins = { '1': { clusters: 0, attached: 0, contested: 0, falsePairClusterUses: 0 },
      '2-5': { clusters: 0, attached: 0, contested: 0, falsePairClusterUses: 0 },
      '6+': { clusters: 0, attached: 0, contested: 0, falsePairClusterUses: 0 } };
    for (const pair of report.pairs) {
      const run = pair.runs.find((run) => run.corpus === corpus && run.threshold === 0.55 && run.strategy === strategy);
      for (const evidence of run.evidence) {
        const bin = bins[evidence.size === 1 ? '1' : evidence.size <= 5 ? '2-5' : '6+'];
        bin.clusters += 1; if (evidence.attachedTo) bin.attached += 1; if (evidence.sharedClaim) bin.contested += 1;
        bin.falsePairClusterUses += run.rows.filter((row) => row.category !== 'positive' && row.decision === 'pair'
          && row.faces.some((face) => face.clusterId === evidence.clusterId && face.person)).length;
      }
    }
    bias[strategy] = bins;
  }
  report.analysis[corpus] = { failures, bias };
}
report.timeBuckets = [];
for (const [name, low, high] of [['short', 0, 5], ['medium', 5, 10], ['long', 10, Infinity]]) {
  const selected = report.pairs.map((pair) => ({ pair, timestamps: pair.timeGaps.filter((gap) => gap.seconds >= low && gap.seconds < high).map((gap) => gap.timestamp) }));
  const similarities = selected.flatMap(({ pair, timestamps }) => pair.baseline.rows.filter((row) => row.category === 'positive' && timestamps.includes(row.timestamp))
    .flatMap((row) => Object.values(row.targetReferenceSimilarities).filter((scores) => scores.length).map((scores) => Math.max(...scores))));
  const resultsByMode = {};
  for (const mode of ['baseline', 'references', 'all']) {
    const rows = selected.flatMap(({ pair, timestamps }) => (mode === 'baseline' ? pair.baseline.rows
      : pair.runs.find((run) => run.corpus === mode && run.strategy === 'top-k' && run.threshold === 0.55).rows).filter((row) => timestamps.includes(row.timestamp)));
    resultsByMode[mode] = summary(rows);
  }
  report.timeBuckets.push({ name, lowerSeconds: low, upperSeconds: Number.isFinite(high) ? high : null,
    measuredTargetSimilarities: similarities.length,
    meanBestTargetSimilarity: similarities.length ? similarities.reduce((sum, value) => sum + value, 0) / similarities.length : null,
    ...resultsByMode });
}
await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log('Baseline', JSON.stringify(report.baseline));
for (const row of report.configurations.filter((row) => row.threshold === 0.55)) console.log(JSON.stringify(row));
