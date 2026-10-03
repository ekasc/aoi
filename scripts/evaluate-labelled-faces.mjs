#!/usr/bin/env node
/**
 * Real-photo evaluation for cluster-first recognition (experimental spike).
 *
 * Point it at a local labelled folder and it runs the real Apple Vision + SFace
 * pipeline over every image, clusters the faces, identifies the two enrolled
 * people from the reference folder, and compares cluster-first against the
 * current fixed-reference matcher. Nothing is uploaded; the report is local.
 *
 *   node scripts/evaluate-labelled-faces.mjs --dataset <folder>
 *
 * Folder layout:
 *   references/   a.jpg or a-1.jpg, a-2.jpg, ...; b.jpg or b-1.jpg, b-2.jpg, ...
 *   positive/     both people visibly present
 *   solo-a/       only partner A
 *   solo-b/       only partner B
 *   negative/     neither person
 *   groups/       group photos with zero or one enrolled person
 *
 * Labels come only from the enclosing folder. File names are never read for a
 * label.
 */

import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createMacFaceEngine, loadAppModules } from './face-eval-engine.mjs';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff', '.webp']);
const SWEEP_THRESHOLDS = [0.4, 0.5, 0.55, 0.65, 0.75];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

function parseArgs(args) {
  const options = { dataset: null, corpus: 'all', strategy: null, clusterThreshold: null };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--dataset') options.dataset = args[++index];
    else if (value === '--corpus') options.corpus = args[++index];
    else if (value === '--strategy') options.strategy = args[++index];
    else if (value === '--cluster-threshold') options.clusterThreshold = Number(args[++index]);
    else if (value === '--help' || value === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

const USAGE = `Usage: node scripts/evaluate-labelled-faces.mjs --dataset <folder> [--corpus all|references] [--strategy <name>] [--cluster-threshold <0-1>]

Folder layout (labels come only from the folder name):
  references/   a.jpg or a-1.jpg, a-2.jpg; b.jpg or b-1.jpg, b-2.jpg
  positive/     both people visibly present
  solo-a/       only partner A
  solo-b/       only partner B
  negative/     neither person
  groups/       group photos with zero or one enrolled person

Options:
  --corpus all         index every photo, as production would (default)
  --corpus references  cluster only the reference faces; query photos are held out
  --strategy <name>    identity strategy: max | mean | median | trimmed-mean | majority-vote | member-support
  --cluster-threshold  cluster similarity threshold in [0, 1]

No photo, crop, embedding, or path is uploaded. The report is written under .expo/face-lab and must stay local.`;

export async function main(args) {
  const options = parseArgs(args);
  if (options.help || !options.dataset) { console.log(USAGE); return; }
  const directory = resolve(options.dataset);
  if (!existsSync(directory)) throw new Error(`Dataset folder does not exist: ${directory}`);
  if (options.corpus !== 'all' && options.corpus !== 'references') throw new Error('--corpus must be all or references');

  loadAppModules();
  const { fitFaceAlignment } = await import('../features/album/face-alignment.ts');
  const { DEFAULT_MATCH_THRESHOLD, matchPairByCosine } = await import('../features/album/face-pipeline.ts');
  const { createIndexedFace } = await import('../features/face-index/embedding.ts');
  const { createFaceClusterer, SPIKE_CLUSTER_OPTIONS } = await import('../features/face-index/clusterer.ts');
  const { identifyPartnerClustersWithEvidence, identityByCluster, IDENTITY_STRATEGIES, SPIKE_IDENTIFICATION_OPTIONS } = await import('../features/face-index/identify.ts');
  const { findCouplePhotos } = await import('../features/face-index/pair-query.ts');
  const { datasetMetadata, parseLabelledPath, parseReferencePath, summarizeLabelledOutcomes } = await import('../features/face-index/labelled-dataset.ts');

  const allFiles = await walk(directory);
  const references = { A: [], B: [] };
  const labelled = [];
  for (const file of allFiles) {
    const relativePath = relative(directory, file);
    const reference = parseReferencePath(relativePath);
    if (reference) { references[reference.person].push(reference.file); continue; }
    const entry = parseLabelledPath(relativePath);
    if (entry) labelled.push(entry);
  }
  if (!references.A.length || !references.B.length) throw new Error('Add at least one references/a* and one references/b* photo.\n\n' + USAGE);
  if (!labelled.length) throw new Error('No labelled photos found in positive/, solo-a/, solo-b/, negative/, or groups/.\n\n' + USAGE);
  references.A.sort(); references.B.sort(); labelled.sort((left, right) => left.file.localeCompare(right.file));

  const strategy = options.strategy ?? SPIKE_IDENTIFICATION_OPTIONS.strategy;
  if (!IDENTITY_STRATEGIES.includes(strategy)) throw new Error(`Unknown strategy: ${strategy}. Use one of ${IDENTITY_STRATEGIES.join(', ')}`);
  const clusterThreshold = options.clusterThreshold ?? SPIKE_CLUSTER_OPTIONS.similarityThreshold;
  if (!Number.isFinite(clusterThreshold) || clusterThreshold <= 0 || clusterThreshold > 1) throw new Error('--cluster-threshold must be between zero and one');

  const engineHandle = await createMacFaceEngine();
  const { engine } = engineHandle;
  try {
    const embedFile = async (relativePath) => {
      const uri = pathToFileURL(join(directory, relativePath)).href;
      const faces = [];
      let detected = 0, alignmentFailures = 0, embeddingFailures = 0, detectFailed = false;
      try {
        const observations = await engine.detect(uri);
        detected = observations.length;
        for (const [index, face] of observations.entries()) {
          if (!face.landmarks || !fitFaceAlignment(face.landmarks)) { alignmentFailures += 1; continue; }
          let embedding;
          try { embedding = await engine.embed(uri, face); }
          catch { embeddingFailures += 1; continue; }
          const created = createIndexedFace({
            faceId: `${relativePath}#${index}`,
            assetId: relativePath,
            embedding,
            detectionScore: typeof face.captureQuality === 'number' ? face.captureQuality : 1,
            qualityScore: Math.max(0, Math.min(1, Math.min(face.width, face.height) / 112)),
          });
          if (created) faces.push(created); else embeddingFailures += 1;
        }
      } catch { detectFailed = true; }
      return { faces, detected, alignmentFailures, embeddingFailures, detectFailed };
    };

    const results = new Map();
    const referenceFiles = [...references.A, ...references.B];
    const order = [...referenceFiles, ...labelled.map((entry) => entry.file)];
    let processed = 0;
    for (const file of order) {
      results.set(file, await embedFile(file));
      processed += 1;
      if (processed % 25 === 0) console.log(`Embedded ${processed}/${order.length}`);
    }

    const detection = { files: order.length, detected: 0, embedded: 0, alignmentFailures: 0, embeddingFailures: 0, detectFailures: 0 };
    for (const result of results.values()) {
      detection.detected += result.detected;
      detection.embedded += result.faces.length;
      detection.alignmentFailures += result.alignmentFailures;
      detection.embeddingFailures += result.embeddingFailures;
      if (result.detectFailed) detection.detectFailures += 1;
    }

    const referenceFaces = (person) => references[person].flatMap((file) => results.get(file)?.faces ?? []);
    const referenceEmbeddings = { A: referenceFaces('A').map((face) => face.embedding), B: referenceFaces('B').map((face) => face.embedding) };

    const buildClusters = (threshold) => {
      const clusterer = createFaceClusterer({ ...SPIKE_CLUSTER_OPTIONS, similarityThreshold: threshold, lowQualityThreshold: Math.max(SPIKE_CLUSTER_OPTIONS.lowQualityThreshold, threshold) });
      const corpus = options.corpus === 'all'
        ? order.flatMap((file) => results.get(file)?.faces ?? [])
        : [...referenceFaces('A'), ...referenceFaces('B')];
      for (const face of corpus.sort((left, right) => left.faceId.localeCompare(right.faceId))) clusterer.assign(face);
      return { clusterer, clusters: clusterer.clusters() };
    };

    const assignmentFor = (clusterer, face) => clusterer.assignmentFor(face.faceId)
      ?? (() => { const classified = clusterer.classify(face); return classified ? { ...classified, assetId: face.assetId } : null; })();

    const attachmentMetrics = (evidence) => ({
      attachedA: evidence.filter((item) => item.attachedTo === 'A').length,
      attachedB: evidence.filter((item) => item.attachedTo === 'B').length,
      sharedClaimed: evidence.filter((item) => item.sharedClaim).length,
    });

    const runClusterConfig = (clusterer, identification, evidence) => {
      const mapping = identityByCluster(identification);
      const evidenceByCluster = new Map(evidence.map((item) => [item.clusterId, item]));
      const rows = [];
      const diagnostics = [];
      for (const entry of labelled) {
        const result = results.get(entry.file);
        const assignments = new Map();
        let assignedToPerson = false, assignedToUnmappedCluster = false, assignedToAnyCluster = false;
        for (const face of result.faces) {
          const assignment = assignmentFor(clusterer, face);
          if (!assignment) continue;
          assignments.set(face.faceId, assignment);
          assignedToAnyCluster = true;
          if (mapping.has(assignment.clusterId)) assignedToPerson = true; else assignedToUnmappedCluster = true;
        }
        const [diagnostic] = findCouplePhotos({ assets: [{ assetId: entry.file, faces: result.faces }], assignments, identityByCluster: mapping });
        const failed = result.detectFailed || (result.detected > 0 && result.faces.length === 0);
        const decision = failed ? 'failed' : diagnostic.decision;
        rows.push({
          category: entry.category,
          expectation: entry.expectation,
          decision,
          detectedFaces: result.detected,
          embeddedFaces: result.faces.length,
          alignmentFailures: result.alignmentFailures,
          embeddingFailures: result.embeddingFailures,
          identityAmbiguous: identification.kind !== 'identified',
          assignedToPerson,
          assignedToUnmappedCluster,
          assignedToAnyCluster,
        });
        diagnostics.push({
          asset: entry.file,
          category: entry.category,
          detectedFaces: result.detected,
          embeddedFaces: result.faces.length,
          alignmentFailures: result.alignmentFailures,
          embeddingFailures: result.embeddingFailures,
          faces: result.faces.map((face) => {
            const assignment = assignments.get(face.faceId);
            const cluster = assignment ? evidenceByCluster.get(assignment.clusterId) : undefined;
            return {
              clusterId: assignment?.clusterId ?? null,
              person: assignment ? mapping.get(assignment.clusterId) ?? null : null,
              similarity: assignment?.similarity ?? null,
              clusterAttachedTo: cluster?.attachedTo ?? null,
              clusterReason: cluster?.reason ?? null,
            };
          }),
          decision,
          reason: diagnostic.reason,
        });
      }
      return { rows, diagnostics };
    };

    const baselineRows = labelled.map((entry) => {
      const result = results.get(entry.file);
      const prints = [
        ...referenceEmbeddings.A.map((embedding) => ({ person: 'you', embedding })),
        ...referenceEmbeddings.B.map((embedding) => ({ person: 'partner', embedding })),
      ];
      const baseline = prints.length ? matchPairByCosine(result.faces.map((face) => face.embedding), prints, DEFAULT_MATCH_THRESHOLD) : { kind: 'unsure' };
      const failed = result.detectFailed || (result.detected > 0 && result.faces.length === 0);
      return {
        category: entry.category,
        expectation: entry.expectation,
        decision: failed ? 'failed' : baseline.kind === 'pair' ? 'pair' : baseline.kind === 'no-faces' ? 'no-faces' : 'unsure',
        detectedFaces: result.detected,
        embeddedFaces: result.faces.length,
        alignmentFailures: result.alignmentFailures,
        embeddingFailures: result.embeddingFailures,
        identityAmbiguous: false,
        assignedToPerson: false,
        assignedToUnmappedCluster: false,
        assignedToAnyCluster: false,
      };
    });

    const identificationOptions = { ...SPIKE_IDENTIFICATION_OPTIONS, strategy };
    const { clusterer, clusters } = buildClusters(clusterThreshold);
    const identified = identifyPartnerClustersWithEvidence(clusters, referenceEmbeddings, identificationOptions);
    const identification = identified.identification;
    const clusterRun = runClusterConfig(clusterer, identification, identified.evidence);

    const thresholdSweep = [];
    for (const threshold of SWEEP_THRESHOLDS) {
      const built = buildClusters(threshold);
      const swept = identifyPartnerClustersWithEvidence(built.clusters, referenceEmbeddings, identificationOptions);
      const run = runClusterConfig(built.clusterer, swept.identification, swept.evidence);
      thresholdSweep.push({ clusterThreshold: threshold, clusters: built.clusters.length, identificationKind: swept.identification.kind, attachment: attachmentMetrics(swept.evidence), summary: summarizeLabelledOutcomes(run.rows) });
    }

    const strategyComparison = [];
    for (const candidate of IDENTITY_STRATEGIES) {
      const compared = identifyPartnerClustersWithEvidence(clusters, referenceEmbeddings, { ...identificationOptions, strategy: candidate });
      const run = runClusterConfig(clusterer, compared.identification, compared.evidence);
      strategyComparison.push({ strategy: candidate, identificationKind: compared.identification.kind, clusters: clusters.length, attachment: attachmentMetrics(compared.evidence), summary: summarizeLabelledOutcomes(run.rows) });
    }

    const report = {
      version: 1,
      dataset: datasetMetadata({ root: directory, entries: labelled, references, corpus: options.corpus }),
      model: { modelId: engine.modelId, clusterThreshold, clusterOptions: SPIKE_CLUSTER_OPTIONS, identificationOptions, baselineThreshold: DEFAULT_MATCH_THRESHOLD },
      detection,
      identification: { kind: identification.kind, reason: identification.kind === 'ambiguous' ? identification.reason : null, clusters: clusters.length, attached: identification.identities.length },
      clusterEvidence: identified.evidence,
      configs: {
        baselineFixedReference: summarizeLabelledOutcomes(baselineRows),
        clusterFirst: summarizeLabelledOutcomes(clusterRun.rows),
      },
      thresholdSweep,
      strategyComparison,
      diagnostics: clusterRun.diagnostics,
      privacy: 'Local report. It contains relative file names for debugging and no image bytes, crops, embeddings, or absolute dataset path. Do not share it.',
      readyForProduction: false,
      limitations: [
        'Real-photo labels are the enclosing folder only; per-face identity is not labelled, so cluster purity and pairwise recall are not measurable here.',
        'The baseline uses every supplied reference; production currently stores one per person, so this is a stronger baseline.',
        'False-pair rates are only as trustworthy as the negative and group sample size.',
        'Mac Vision and CPU inference are not an iPhone parity check.',
      ],
    };
    const output = join(engineHandle.workspace, `real-face-report-${Date.now()}.json`);
    await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({
      sampleSize: report.configs.clusterFirst.sampleSize,
      detection,
      identification: report.identification,
      baseline: report.configs.baselineFixedReference,
      clusterFirst: report.configs.clusterFirst,
      thresholdSweep: thresholdSweep.map((entry) => ({ threshold: entry.clusterThreshold, recall: entry.summary.positivePairRecall, falsePairs: entry.summary.falsePairAdditions, attachment: entry.attachment })),
      strategyComparison: strategyComparison.map((entry) => ({ strategy: entry.strategy, recall: entry.summary.positivePairRecall, falsePairs: entry.summary.falsePairAdditions, ambiguity: entry.summary.classification.ambiguousIdentity, attachment: entry.attachment })),
    }, null, 2));
    console.log(`Report: ${output}`);
  } finally {
    await engineHandle.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Real-photo evaluation did not finish.');
    process.exitCode = 1;
  });
}
