#!/usr/bin/env node
/**
 * Cluster-first recognition evaluation (experimental spike).
 *
 * Answers one question on a labelled, local dataset: does indexing every
 * detected face and clustering embeddings into identities find couple photos
 * better than comparing each face against one fixed reference per person?
 *
 * It reuses the same Apple Vision detector, SFace model, and alignment as the
 * app. It writes only aggregate counts and anonymous scores. No photo, crop,
 * embedding, path, or identity leaves the machine, and nothing is uploaded.
 *
 * Usage:
 *   node scripts/evaluate-face-index.mjs [--benchmark <prepared-subset>]
 *
 * Reuses the local tools prepared by:
 *   node scripts/test-face-recognition.mjs --setup
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { prepareFaceModel } from './prepare-face-model.mjs';
import { startFaceHelper } from './face-test-process.mjs';
import { loadAppModules } from './test-face-recognition.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BENCHMARK = join(root, '.expo/face-benchmark/hyperface-subset');
const IDENTITY_IMAGE = /^identity-\d{3}\/image-(\d{2})\.(png|jpe?g)$/;

function run(command, args, timeout = 300_000) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1' } });
  if (result.error || result.status !== 0) throw new Error('Local tool setup failed. Run node scripts/test-face-recognition.mjs --setup first.');
}

function imageIndex(file) {
  const match = IDENTITY_IMAGE.exec(file);
  return match ? Number(match[1]) : null;
}

function expectation(kind) {
  if (kind === 'pair' || kind === 'group') return 'positive';
  if (kind === 'solo-you') return 'solo-A';
  if (kind === 'solo-partner') return 'solo-B';
  return 'negative';
}

function tallyByKind(outcomes, kinds) {
  const byKind = {};
  outcomes.forEach((outcome, index) => {
    const kind = kinds[index] ?? 'unknown';
    byKind[kind] ??= { total: 0, accepted: 0 };
    byKind[kind].total += 1;
    if (outcome.decision === 'pair') byKind[kind].accepted += 1;
  });
  return byKind;
}

function parseArgs(args) {
  let directory = DEFAULT_BENCHMARK;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--benchmark') directory = resolve(args[index + 1] ?? '');
    else if (args[index].startsWith('--')) throw new Error('Usage: node scripts/evaluate-face-index.mjs [--benchmark <prepared-subset>]');
    else directory = resolve(args[index]);
  }
  return directory;
}

export async function main(args) {
  if (process.platform !== 'darwin') throw new Error('This evaluator needs macOS for the same Apple Vision detector used by Aoi.');
  const directory = parseArgs(args);
  const manifestPath = join(directory, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('Use a prepared benchmark folder containing manifest.json.');
  const python = process.env.AOI_FACE_REFERENCE_PYTHON ?? join(root, '.expo/face-reference-venv/bin/python');
  if (!existsSync(python)) throw new Error('Run node scripts/test-face-recognition.mjs --setup once to prepare local tools.');
  await prepareFaceModel(true);
  loadAppModules();

  const { createFaceRecognitionEngine } = await import('../features/album/face-recognition-engine.ts');
  const { parseDetectedPhotoFaces } = await import('../features/album/photo-face-detector.ts');
  const { DEFAULT_MATCH_THRESHOLD, matchPairByCosine } = await import('../features/album/face-pipeline.ts');
  const { createIndexedFace } = await import('../features/face-index/embedding.ts');
  const { createFaceClusterer, SPIKE_CLUSTER_OPTIONS } = await import('../features/face-index/clusterer.ts');
  const { identifyPartnerClusters, identityByCluster, SPIKE_IDENTIFICATION_OPTIONS } = await import('../features/face-index/identify.ts');
  const { findCouplePhotos } = await import('../features/face-index/pair-query.ts');
  const { measureClusterQuality, summarizePairOutcomes } = await import('../features/face-index/evaluation.ts');
  const { parsePublicBenchmark } = await import('./public-face-benchmark.ts');

  const rawManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const benchmark = parsePublicBenchmark(rawManifest);
  // The public benchmark parser intentionally drops `kind`; the evaluator needs it to
  // tell a solo-A photo from an unrelated group. Read it from the same verified manifest.
  const kindByFile = new Map(rawManifest.pairCases.flatMap((pair) => pair.photos.map((photo) => [photo.file, photo.kind])));
  const kindOf = (photo) => kindByFile.get(photo.file) ?? 'unknown';
  const requestedThreshold = process.env.AOI_FACE_INDEX_THRESHOLD === undefined ? SPIKE_CLUSTER_OPTIONS.similarityThreshold : Number(process.env.AOI_FACE_INDEX_THRESHOLD);
  const clusterOptions = {
    ...SPIKE_CLUSTER_OPTIONS,
    similarityThreshold: requestedThreshold,
    lowQualityThreshold: Math.max(SPIKE_CLUSTER_OPTIONS.lowQualityThreshold, requestedThreshold),
  };
  const identificationOptions = SPIKE_IDENTIFICATION_OPTIONS;

  const workspace = join(root, '.expo/face-lab');
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(join(workspace, 'index-scratch-'));
  await chmod(scratch, 0o700);
  const helpers = [];
  let engine = null;
  const abort = new AbortController();
  const stop = () => { abort.abort(); for (const helper of helpers) void helper.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const lifetime = setTimeout(stop, 45 * 60_000);
  const uriFor = (file) => pathToFileURL(resolve(directory, file)).href;

  try {
    await copyFile(join(root, 'scripts/face-test-native.swift'), join(scratch, 'main.swift'));
    run('xcrun', ['swiftc', '-O', '-module-cache-path', join(scratch, 'module-cache'), join(root, 'modules/aoi-face-detector/ios/FacePhoto.swift'), join(scratch, 'main.swift'), '-o', join(scratch, 'native')]);
    const native = startFaceHelper(join(scratch, 'native'), []); helpers.push(native);
    const inference = startFaceHelper(python, [join(root, 'scripts/face-test-inference.py'), join(root, 'assets/models/sface.onnx')]); helpers.push(inference);
    await native.ready; await inference.ready;
    engine = createFaceRecognitionEngine({
      detect: async (uri) => parseDetectedPhotoFaces((await native.request({ op: 'detect', uri, modernFallback: true })).value),
      prepare: async (uri, transform) => (await native.request({ op: 'prepare', uri, transform: [transform.a, transform.b, transform.tx, transform.ty] })).value,
      loadSession: async () => ({ embed: async (pixels) => {
        try { return Float32Array.from((await inference.request({ pixels: Array.from(pixels) })).value); }
        finally { pixels.fill(0); }
      }, release: async () => {} }),
    });
    await engine.isAvailable();

    // ── Embed every file the benchmark references, once ─────────────────────
    const files = new Set(benchmark.identities.flatMap((identity) => identity.images.map((image) => image.file)));
    for (const pair of benchmark.pairCases) for (const photo of pair.photos) files.add(photo.file);
    const shaByFile = new Map([
      ...benchmark.identities.flatMap((identity) => identity.images.map((image) => [image.file, image.sha256])),
      ...benchmark.pairCases.flatMap((pair) => pair.photos.map((photo) => [photo.file, photo.sha256])),
    ]);
    const embeddings = new Map();
    const detection = { files: 0, identityExpected: 0, identityDetected: 0, mosaicExpected: 0, mosaicDetected: 0, detected: 0, embedded: 0, failures: 0 };
    let processed = 0;
    for (const file of [...files].sort()) {
      if (abort.signal.aborted) throw new Error('Evaluation canceled. No report was saved.');
      const digest = createHash('sha256').update(await readFile(resolve(directory, file))).digest('hex');
      if (digest !== shaByFile.get(file)) throw new Error('Benchmark image checksum mismatch');
      const uri = uriFor(file);
      const faces = await engine.detect(uri);
      const indexed = [];
      for (const [index, face] of faces.entries()) {
        const detectionScore = typeof face.captureQuality === 'number' ? face.captureQuality : 1;
        const qualityScore = Math.max(0, Math.min(1, Math.min(face.width, face.height) / 112));
        let embedding;
        try { embedding = await engine.embed(uri, face); }
        catch { detection.failures += 1; continue; }
        const created = createIndexedFace({ faceId: `${file}#${index}`, assetId: file, embedding, detectionScore, qualityScore });
        if (created) indexed.push(created);
        else detection.failures += 1;
      }
      embeddings.set(file, { faces: indexed, detected: faces.length });
      detection.files += 1; detection.detected += faces.length; detection.embedded += indexed.length;
      processed += 1;
      if (processed % 50 === 0) console.log(`Embedded ${processed}/${files.size}`);
    }
    for (const identity of benchmark.identities) {
      for (const image of identity.images) {
        detection.identityExpected += 1;
        if (embeddings.get(image.file)?.detected === 1) detection.identityDetected += 1;
      }
    }
    for (const pair of benchmark.pairCases) {
      for (const photo of pair.photos) {
        detection.mosaicExpected += photo.sourceImages.length;
        detection.mosaicDetected += embeddings.get(photo.file)?.detected ?? 0;
      }
    }

    // ── Modes: everything indexed, and a held-out split ─────────────────────
    const modes = [
      { name: 'indexed', corpusIndexMax: Infinity, queryIndexMin: 0, label: 'Every portrait indexed (production shape; query photos are cluster members)' },
      { name: 'heldOut', corpusIndexMax: 3, queryIndexMin: 4, label: 'Corpus limited to portraits 0-3; query photos 4-7 were never indexed' },
    ];

    const evaluateMode = (mode) => {
      const corpusFiles = benchmark.identities.flatMap((identity) => identity.images.filter((image) => (imageIndex(image.file) ?? 0) <= mode.corpusIndexMax).map((image) => image.file));
      const truthByFace = new Map();
      for (const identity of benchmark.identities) {
        for (const image of identity.images) for (const face of embeddings.get(image.file)?.faces ?? []) truthByFace.set(face.faceId, identity.label);
      }
      const clusterer = createFaceClusterer(clusterOptions);
      const corpusFaces = corpusFiles.flatMap((file) => embeddings.get(file)?.faces ?? []).sort((left, right) => left.faceId.localeCompare(right.faceId));
      for (const face of corpusFaces) clusterer.assign(face);
      const clusters = clusterer.clusters();
      const clustering = measureClusterQuality(clusters, truthByFace);

      const queryPhotos = benchmark.pairCases.flatMap((pair) => pair.photos.filter((photo) => photo.sourceImages.every((source) => (imageIndex(source) ?? 0) >= mode.queryIndexMin)));
      const identification = { cases: 0, identified: 0, ambiguous: 0, correct: 0, reasons: {} };

      const runComparison = (referenceCount) => {
        const outcomes = [];
        const baselineOutcomes = [];
        const perCase = [];
        for (const pair of benchmark.pairCases) {
          const youIdentity = benchmark.identities.find((identity) => identity.label === pair.you);
          const partnerIdentity = benchmark.identities.find((identity) => identity.label === pair.partner);
          const references = (identity) => identity.images.slice(0, referenceCount).flatMap((image) => embeddings.get(image.file)?.faces ?? []);
          const youPrints = references(youIdentity);
          const partnerPrints = references(partnerIdentity);
          const result = identifyPartnerClusters(clusters, { A: youPrints.map((face) => face.embedding), B: partnerPrints.map((face) => face.embedding) }, identificationOptions);
          const mapping = identityByCluster(result);
          const caseSummary = { pair: pair.label, kind: result.kind, reason: result.kind === 'ambiguous' || result.kind === 'invalid' ? result.reason : null, correct: null, photos: 0 };
          if (result.kind === 'identified') {
            const majority = (clusterId) => {
              const cluster = clusters.find((item) => item.clusterId === clusterId);
              const counts = new Map();
              for (const faceId of cluster?.faceIds ?? []) { const label = truthByFace.get(faceId); if (label) counts.set(label, (counts.get(label) ?? 0) + 1); }
              return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
            };
            const identityOf = (person) => result.identities.find((identity) => identity.person === person);
            caseSummary.correct = majority(identityOf('A')?.clusterId) === pair.you && majority(identityOf('B')?.clusterId) === pair.partner;
          }

          for (const photo of pair.photos.filter((item) => item.sourceImages.every((source) => (imageIndex(source) ?? 0) >= mode.queryIndexMin))) {
            const faces = embeddings.get(photo.file)?.faces ?? [];
            const assignments = new Map();
            for (const face of faces) {
              const classified = clusterer.classify(face);
              if (classified) assignments.set(face.faceId, { ...classified, assetId: photo.file });
            }
            const [diagnostic] = findCouplePhotos({ assets: [{ assetId: photo.file, faces }], assignments, identityByCluster: mapping });
            outcomes.push({ expectation: expectation(kindOf(photo)), decision: diagnostic.decision });
            const prints = [
              { person: 'you', embedding: youPrints[0]?.embedding },
              { person: 'partner', embedding: partnerPrints[0]?.embedding },
            ].filter((print) => print.embedding);
            const baseline = prints.length === 2 ? matchPairByCosine(faces.map((face) => face.embedding), prints, DEFAULT_MATCH_THRESHOLD) : { kind: 'unsure' };
            baselineOutcomes.push({ expectation: expectation(kindOf(photo)), decision: baseline.kind === 'pair' ? 'pair' : baseline.kind === 'no-faces' ? 'no-faces' : 'unsure' });
            caseSummary.photos += 1;
          }
          perCase.push(caseSummary);
        }
        const summary = summarizePairOutcomes(outcomes);
        return { summary, byKind: tallyByKind(outcomes, queryPhotos.map(kindOf)), baseline: summarizePairOutcomes(baselineOutcomes), perCase };
      };

      // identification metrics use the multi-reference mapping, once per case.
      for (const pair of benchmark.pairCases) {
        const youIdentity = benchmark.identities.find((identity) => identity.label === pair.you);
        const partnerIdentity = benchmark.identities.find((identity) => identity.label === pair.partner);
        const references = (identity) => identity.images.filter((image) => (imageIndex(image.file) ?? 0) <= mode.corpusIndexMax).flatMap((image) => embeddings.get(image.file)?.faces ?? []);
        const result = identifyPartnerClusters(clusters, { A: references(youIdentity).map((face) => face.embedding), B: references(partnerIdentity).map((face) => face.embedding) }, identificationOptions);
        identification.cases += 1;
        if (result.kind === 'identified') {
          identification.identified += 1;
          const majority = (clusterId) => {
            const cluster = clusters.find((item) => item.clusterId === clusterId);
            const counts = new Map();
            for (const faceId of cluster?.faceIds ?? []) { const label = truthByFace.get(faceId); if (label) counts.set(label, (counts.get(label) ?? 0) + 1); }
            return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
          };
          const identityOf = (person) => result.identities.find((identity) => identity.person === person);
          if (majority(identityOf('A')?.clusterId) === pair.you && majority(identityOf('B')?.clusterId) === pair.partner) identification.correct += 1;
        } else {
          identification.ambiguous += 1;
          const reason = result.kind === 'invalid' ? 'invalid enrollment' : result.reason;
          identification.reasons[reason] = (identification.reasons[reason] ?? 0) + 1;
        }
      }

      const single = runComparison(1);
      const multi = runComparison(Math.min(4, ...benchmark.identities.map((identity) => identity.images.length)));
      return {
        label: mode.label,
        corpus: { files: corpusFiles.length, faces: corpusFaces.length, clusters: clusters.length, largest: clusters.map((cluster) => cluster.size).sort((a, b) => b - a).slice(0, 5) },
        clustering,
        identification,
        clusterSingleReference: { pair: single.summary, byKind: single.byKind },
        clusterMultiReference: { pair: multi.summary, byKind: multi.byKind },
        baselineSingleReference: { pair: single.baseline },
      };
    };

    const evaluated = Object.fromEntries(modes.map((mode) => [mode.name, evaluateMode(mode)]));

    // ── Exploratory threshold sweep on the held-out split only ──────────────
    const sweep = [];
    for (const threshold of [0.4, 0.5, 0.55, 0.65, 0.75]) {
      if (abort.signal.aborted) throw new Error('Evaluation canceled. No report was saved.');
      const mode = modes[1];
      const corpusFiles = benchmark.identities.flatMap((identity) => identity.images.filter((image) => (imageIndex(image.file) ?? 0) <= mode.corpusIndexMax).map((image) => image.file));
      const truthByFace = new Map();
      for (const identity of benchmark.identities) for (const image of identity.images) for (const face of embeddings.get(image.file)?.faces ?? []) truthByFace.set(face.faceId, identity.label);
      const clusterer = createFaceClusterer({ ...clusterOptions, similarityThreshold: threshold, lowQualityThreshold: Math.max(clusterOptions.lowQualityThreshold, threshold) });
      for (const face of corpusFiles.flatMap((file) => embeddings.get(file)?.faces ?? []).sort((left, right) => left.faceId.localeCompare(right.faceId))) clusterer.assign(face);
      const clusters = clusterer.clusters();
      const outcomes = [];
      for (const pair of benchmark.pairCases) {
        const youIdentity = benchmark.identities.find((identity) => identity.label === pair.you);
        const partnerIdentity = benchmark.identities.find((identity) => identity.label === pair.partner);
        const references = (identity) => identity.images.filter((image) => (imageIndex(image.file) ?? 0) <= mode.corpusIndexMax).flatMap((image) => embeddings.get(image.file)?.faces ?? []);
        const result = identifyPartnerClusters(clusters, { A: references(youIdentity).map((face) => face.embedding), B: references(partnerIdentity).map((face) => face.embedding) }, identificationOptions);
        const mapping = identityByCluster(result);
        for (const photo of pair.photos.filter((item) => item.sourceImages.every((source) => (imageIndex(source) ?? 0) >= mode.queryIndexMin))) {
          const faces = embeddings.get(photo.file)?.faces ?? [];
          const assignments = new Map();
          for (const face of faces) { const classified = clusterer.classify(face); if (classified) assignments.set(face.faceId, { ...classified, assetId: photo.file }); }
          const [diagnostic] = findCouplePhotos({ assets: [{ assetId: photo.file, faces }], assignments, identityByCluster: mapping });
          outcomes.push({ expectation: expectation(kindOf(photo)), decision: diagnostic.decision });
        }
      }
      sweep.push({ similarityThreshold: threshold, clusters: clusters.length, clustering: measureClusterQuality(clusters, truthByFace), pair: summarizePairOutcomes(outcomes) });
    }

    const report = {
      version: 1,
      dataset: { name: benchmark.dataset, license: benchmark.license, source: benchmark.source, synthetic: true, note: 'Artificial portrait mosaics, not natural group photos.' },
      model: { modelId: engine.modelId, clusterOptions, identificationOptions, qualityHeuristic: 'min(faceMinSide, 112) / 112', baselineThreshold: DEFAULT_MATCH_THRESHOLD },
      totals: detection,
      modes: evaluated,
      thresholdSweepHeldOut: sweep,
      privacy: 'Aggregate counts and anonymous scores only. No photos, crops, embeddings, source URIs, or identity labels are written.',
      readyForProduction: false,
      limitations: [
        'Synthetic portraits and artificial mosaics, not natural group photos or a real couple library.',
        'The held-out split still shares one generator and one model; it is not independent validation data.',
        'Quality score is a face-size heuristic, not a calibrated capture-quality model.',
        'The threshold sweep is exploratory. No production threshold was selected.',
        'Mac Vision and CPU inference are not an iPhone parity check.',
      ],
    };
    const output = join(workspace, `face-index-report-${Date.now()}.json`);
    await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({
      totals: detection,
      indexed: evaluated.indexed.clustering,
      heldOut: evaluated.heldOut.clustering,
      heldOutIdentification: evaluated.heldOut.identification,
      heldOutBaseline: evaluated.heldOut.baselineSingleReference.pair,
      heldOutClusterSingle: evaluated.heldOut.clusterSingleReference.pair,
      heldOutClusterMulti: evaluated.heldOut.clusterMultiReference.pair,
      sweep: sweep.map((entry) => ({ threshold: entry.similarityThreshold, clusters: entry.clusters, found: entry.pair.positives.found, positiveTotal: entry.pair.positives.total, falseAdditions: entry.pair.falsePairAdditions })),
    }, null, 2));
    console.log(`Report: ${output}`);
  } finally {
    clearTimeout(lifetime); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await engine?.dispose();
    for (const helper of helpers.reverse()) await helper.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Face-index evaluation did not finish.');
    process.exitCode = 1;
  });
}
