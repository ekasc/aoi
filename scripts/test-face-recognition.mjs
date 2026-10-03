import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { prepareFaceModel } from './prepare-face-model.mjs';
import { startFaceHelper } from './face-test-process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensions = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff', '.webp']);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export async function readFaceDataset(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { throw new Error('Use an existing local test folder.'); }
  const reference = (person) => {
    const matches = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().replace(/\.[^.]+$/, '') === person && extensions.has(extname(entry.name).toLowerCase()));
    if (matches.length !== 1) throw new Error(`Add exactly one ${person} reference photo to the test folder.`);
    return join(directory, matches[0].name);
  };
  const you = reference('you'), partner = reference('partner');
  const seen = new Set();
  const hash = async (file) => {
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    return digest.digest('hex');
  };
  seen.add(await hash(you));
  const second = await hash(partner);
  if (seen.has(second)) throw new Error('Use a different reference photo for each person.');
  seen.add(second);
  const photos = [], excluded = [];
  for (const [folder, bothPresent] of [['both', true], ['not-both', false]]) {
    const folderPath = join(directory, folder);
    const info = await lstat(folderPath).catch(() => null);
    if (!info?.isDirectory()) throw new Error(`Add a ${folder} folder containing test photos.`);
    const files = (await readdir(folderPath, { withFileTypes: true })).filter((entry) => entry.isFile() && extensions.has(extname(entry.name).toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
    if (!files.length) throw new Error(`Add at least one test photo to ${folder}.`);
    for (const entry of files) {
      const file = join(folderPath, entry.name), id = `photo-${photos.length + excluded.length + 1}`;
      const digest = await hash(file);
      const item = { id, file, name: `${folder}/${entry.name}`, bothPresent };
      if (seen.has(digest)) excluded.push({ ...item, reason: 'Duplicate or reference photo excluded' });
      else { seen.add(digest); photos.push({ ...item, uri: pathToFileURL(file).href }); }
    }
  }
  if (!photos.some((photo) => photo.bothPresent) || !photos.some((photo) => !photo.bothPresent)) throw new Error('Each test folder needs a unique photo that is not a reference.');
  return { references: { you: pathToFileURL(you).href, partner: pathToFileURL(partner).href }, photos, excluded };
}

export function faceTestHtml(summary, rows, dataset) {
  const labels = { found: 'Correctly found', missed: 'Missed', 'incorrect-match': 'Incorrect match', rejected: 'Correctly rejected', failed: 'Could not process' };
  const table = rows.map((row) => {
    const photo = dataset.photos.find((photo) => photo.id === row.id);
    return `<tr><td><a href="${escapeHtml(pathToFileURL(photo.file).href)}">${escapeHtml(photo.name)}</a></td><td>${escapeHtml(labels[row.outcome])}</td><td>${escapeHtml(row.reason)}</td></tr>`;
  }).join('') + dataset.excluded.map((photo) => `<tr><td>${escapeHtml(photo.name)}</td><td>Excluded</td><td>${escapeHtml(photo.reason)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>Aoi recognition test</title>
<style>body{font:17px/1.6 system-ui,sans-serif;max-width:980px;margin:40px auto;padding:0 20px;color:#202020;background:#faf9f7}h1{font-size:30px}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #ccc}a{color:#754058}p{max-width:75ch}.table{overflow-x:auto}</style>
<h1>Aoi recognition test</h1><p>Correctly found: ${summary.found}. Missed: ${summary.missed}. Incorrect matches: ${summary.incorrectMatches}. Correctly rejected: ${summary.rejected}. Could not process: ${summary.failed}.</p>
<p>${dataset.excluded.length} duplicate or reference photos excluded. Your photos stay local. Keep this report private.</p>
<div class="table"><table><caption>Individual photo results. Original-photo links stay local.</caption><thead><tr><th scope="col">Photo</th><th scope="col">Result</th><th scope="col">Reason</th></tr></thead><tbody>${table}</tbody></table></div>
<details><summary>Test limits and privacy</summary><p>Failures are not counted as correct rejections. Cutoff: ${summary.threshold}. No settings were changed.</p>
<p>This is a labeled pair-classification test, not proof of production accuracy or per-face identity accuracy. Mac Vision and CPU inference still need an iPhone parity check. Try varied lighting, angles, group photos, solo photos, and unrelated people.</p>
<p>This private report includes local filenames and links. Do not share it. diagnostics.json contains anonymous IDs and scores only, without images, faceprints, filenames, or links.</p></details></html>`;
}

function run(command, args, timeout = 120_000) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1' } });
  if (result.error || result.status !== 0) throw new Error('Local tool setup failed. Check that Python 3 and Xcode command-line tools are installed.');
}

export function loadAppModules() {
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('@/')) specifier = pathToFileURL(resolve(root, `${specifier.slice(2)}${extname(specifier) ? '' : '.ts'}`)).href;
      else if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) specifier = candidate.href;
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url === pathToFileURL(join(root, 'features/album/sface-model.json')).href) return { shortCircuit: true, format: 'module', source: `export default ${readFileSync(fileURLToPath(url), 'utf8')}` };
      if (url.startsWith(pathToFileURL(root).href + '/') && url.endsWith('.ts')) return { shortCircuit: true, format: 'module-typescript', source: readFileSync(fileURLToPath(url), 'utf8') };
      return next(url, context);
    },
  });
}

export async function main(args) {
  if (args.includes('--help') || !args.length) {
    console.log('Usage: node scripts/test-face-recognition.mjs <test-folder>\nFolder: you.jpg, partner.jpg, both/, not-both/\n--public prepares and tests an independent public synthetic dataset.\n--benchmark <prepared-subset> reruns a prepared public subset.\n--group-benchmark <prepared-folder> compares one and multiple references on public group photos.\n--check checks local tools using a synthetic image. --setup installs local prerequisites once.'); return;
  }
  if (process.platform !== 'darwin') throw new Error('This runner needs macOS for the same Apple Vision photo detector used by Aoi.');
  process.umask(0o077);
  const python = process.env.AOI_FACE_REFERENCE_PYTHON ?? join(root, '.expo/face-reference-venv/bin/python');
  if (args[0] === '--setup') {
    if (!existsSync(python)) run('python3', ['-m', 'venv', dirname(dirname(python))]);
    run(python, ['-m', 'pip', 'install', '-r', 'scripts/face-reference-requirements.txt'], 300_000);
    await prepareFaceModel(false);
    console.log('Local tools ready. Photo tests do not upload anything.'); return;
  }
  const publicBenchmark = args[0] === '--benchmark' || args[0] === '--public';
  const groupBenchmark = args[0] === '--group-benchmark';
  if (args[0] === '--benchmark' || groupBenchmark ? args.length !== 2 : args.length !== 1 || args[0].startsWith('--') && args[0] !== '--check' && args[0] !== '--public') throw new Error('Use one test-folder path, --public, --benchmark or --group-benchmark with a prepared subset, or --check.');
  const dataset = args[0] === '--check' || publicBenchmark || groupBenchmark ? null : await readFaceDataset(resolve(args[0]));
  if (!existsSync(python)) throw new Error('Run node scripts/test-face-recognition.mjs --setup once to prepare local tools.');
  await prepareFaceModel(true);
  const publicDirectory = args[0] === '--public' ? join(root, '.expo/face-benchmark/hyperface-subset') : publicBenchmark ? resolve(args[1]) : null;
  if (args[0] === '--public') {
    if (!existsSync(join(publicDirectory, 'manifest.json'))) run(python, ['scripts/prepare-public-face-benchmark.py', publicDirectory], 360_000);
    run(python, ['scripts/prepare-public-face-benchmark.py', publicDirectory, '--build-pairs']);
  }
  loadAppModules();
  const { createFaceRecognitionEngine, normalizeFaceEmbedding, parseFacePixels, SFACE_MODEL_ID } = await import('../features/album/face-recognition-engine.ts');
  const { parseDetectedPhotoFaces } = await import('../features/album/photo-face-detector.ts');
  const { enrollTestReferences, testLabeledPhoto, summarizeTest } = await import('./face-test-core.ts');
  const workspace = join(root, '.expo/face-tests'); await mkdir(workspace, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(join(workspace, 'scratch-')); await chmod(scratch, 0o700);
  const helpers = [];
  let engine, prints = [];
  let output = null, committed = false;
  const abort = new AbortController();
  const stop = () => { abort.abort(); for (const helper of helpers) void helper.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const lifetime = setTimeout(stop, 30 * 60_000);
  try {
    await copyFile(join(root, 'scripts/face-test-native.swift'), join(scratch, 'main.swift'));
    run('xcrun', ['swiftc', '-O', '-module-cache-path', join(scratch, 'module-cache'), join(root, 'modules/aoi-face-detector/ios/FacePhoto.swift'), join(scratch, 'main.swift'), '-o', join(scratch, 'native')]);
    const native = startFaceHelper(join(scratch, 'native'), []); helpers.push(native); const nativeInfo = await native.ready;
    const inference = startFaceHelper(python, [join(root, 'scripts/face-test-inference.py'), join(root, 'assets/models/sface.onnx')]); helpers.push(inference); const inferenceInfo = await inference.ready;
    if (nativeInfo.ready !== true || inferenceInfo.ready !== true) throw new Error('Local helper did not initialize.');
    const queryFlipFusion = process.env.AOI_FACE_LAB_QUERY_FLIP === '1';
    const modernVisionFallback = process.env.AOI_FACE_LAB_VISION_FALLBACK !== '0';
    engine = createFaceRecognitionEngine({
      detect: async (uri) => parseDetectedPhotoFaces((await native.request({ op: 'detect', uri, modernFallback: modernVisionFallback })).value),
      prepare: async (uri, transform) => (await native.request({ op: 'prepare', uri, transform: [transform.a, transform.b, transform.tx, transform.ty] })).value,
      loadSession: async () => ({ embed: async (pixels) => {
        try { return Float32Array.from((await inference.request({ pixels: Array.from(pixels) })).value); }
        finally { pixels.fill(0); }
      }, release: async () => {} }),
    }, { queryFlipFusion });
    await engine.isAvailable();
    if (groupBenchmark) {
      const { parseGroupSources, runGroupBenchmark } = await import('./public-group-benchmark.ts');
      const directory = resolve(args[1]);
      const metadata = JSON.parse(await readFile(join(directory, 'sources.json'), 'utf8'));
      const sources = parseGroupSources(metadata);
      const report = await runGroupBenchmark(engine, directory, sources, abort.signal);
      output = await mkdtemp(join(workspace, 'public-groups-'));
      await writeFile(join(output, 'report.json'), JSON.stringify({ ...report, queryFlipFusion, modernVisionFallback, preparationComplete: metadata.complete === true, plannedImages: metadata.plannedImages ?? null, availableImages: sources.length, unavailable: metadata.unavailable ?? [], native: nativeInfo, inference: inferenceInfo }, null, 2), { mode: 0o600, flag: 'wx' });
      if (abort.signal.aborted) throw new Error('Test canceled');
      committed = true;
      console.log(JSON.stringify(report, null, 2));
      console.log(`Report: .expo/face-tests/${basename(output)}/report.json`);
      return;
    }
    if (args[0] === '--check') {
      const uri = pathToFileURL(join(scratch, 'synthetic.png')).href;
      await native.request({ op: 'synthetic', uri });
      if ((await engine.detect(uri)).length) throw new Error('Synthetic no-face check failed.');
      const pixels = parseFacePixels((await native.request({ op: 'prepare', uri, transform: [1, 0, 0, 0] })).value);
      try {
        const embedding = normalizeFaceEmbedding(Float32Array.from((await inference.request({ pixels: Array.from(pixels) })).value));
        embedding.fill(0);
      } finally { pixels.fill(0); }
      console.log('Passed: pinned model, shared Vision detection, native pixel preparation, ONNX signature and normalized 128-dimensional output. Synthetic data only; recognition accuracy is not established.'); return;
    }
    if (publicBenchmark) {
      const { parsePublicBenchmark, runPublicBenchmark } = await import('./public-face-benchmark.ts');
      const directory = publicDirectory;
      const benchmark = parsePublicBenchmark(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')));
      const threshold = process.env.AOI_FACE_LAB_THRESHOLD === undefined ? undefined : Number(process.env.AOI_FACE_LAB_THRESHOLD);
      const report = await runPublicBenchmark(engine, directory, benchmark, abort.signal, console.log, threshold);
      output = await mkdtemp(join(workspace, 'public-benchmark-'));
      await writeFile(join(output, 'report.json'), JSON.stringify({ ...report, queryFlipFusion, modernVisionFallback, native: nativeInfo, inference: inferenceInfo }, null, 2), { mode: 0o600, flag: 'wx' });
      if (abort.signal.aborted) throw new Error('Test canceled. No report was saved.');
      committed = true;
      const { genuine, impostor } = report.identityVerification;
      const pairs = report.pairClassification;
      console.log(`Same-identity matches: ${genuine.accepted}/${genuine.accepted + genuine.rejected}. Failed checks: ${genuine.failed}.`);
      console.log(`Different-identity false matches: ${impostor.accepted}/${impostor.accepted + impostor.rejected}. Failed checks: ${impostor.failed}.`);
      console.log(`Pair cases: found ${pairs.found}, missed ${pairs.missed}, incorrect matches ${pairs.incorrectMatches}, rejected ${pairs.rejected}, failed ${pairs.failed}, blocked ${pairs.blockedPhotos}.`);
      console.log('Synthetic portraits and artificial group mosaics. These results do not establish production accuracy.');
      console.log(`Report: .expo/face-tests/${basename(output)}/report.json`);
      return;
    }
    prints = await enrollTestReferences(engine, dataset.references);
    const rows = [];
    for (const photo of dataset.photos) {
      if (abort.signal.aborted) throw new Error('Test canceled. No report was saved.');
      rows.push(await testLabeledPhoto(engine, prints, photo));
      console.log(`Checked ${rows.length}/${dataset.photos.length}`);
    }
    if (abort.signal.aborted) throw new Error('Test canceled. No report was saved.');
    const summary = summarizeTest(rows);
    output = await mkdtemp(join(workspace, 'results-'));
    await writeFile(join(output, 'report.html'), faceTestHtml(summary, rows, dataset), { mode: 0o600, flag: 'wx' });
    await writeFile(join(output, 'diagnostics.json'), JSON.stringify({ version: 1, modelId: SFACE_MODEL_ID, native: nativeInfo, inference: inferenceInfo, summary, excluded: dataset.excluded.length, samples: rows }, null, 2), { mode: 0o600, flag: 'wx' });
    if (abort.signal.aborted) throw new Error('Test canceled. No report was saved.');
    committed = true;
    console.log(`Found ${summary.found}; missed ${summary.missed}; incorrect matches ${summary.incorrectMatches}; rejected ${summary.rejected}; failed ${summary.failed}.\nReport: .expo/face-tests/${basename(output)}/report.html`);
  } finally {
    clearTimeout(lifetime); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    prints.forEach((print) => print.embedding.fill(0));
    await engine?.dispose();
    for (const helper of helpers.reverse()) await helper.close();
    await rm(scratch, { recursive: true, force: true });
    if (output && !committed) await rm(output, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    const safe = error instanceof Error && /^(Add |Use |Each test |The (first|second) reference |Run node |This runner |Local |Test canceled|Synthetic no-face)/.test(error.message);
    console.error(safe ? error.message : 'Recognition test did not finish. Check local prerequisites with --check and the folder layout with --help.');
    process.exitCode = 1;
  });
}
