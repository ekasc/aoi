import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { prepareFaceModel } from './prepare-face-model.mjs';
import { startFaceHelper } from './face-test-process.mjs';

const root = resolve(import.meta.dirname, '..');
const run = promisify(execFile);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) specifier = pathToFileURL(resolve(root, `${specifier.slice(2)}.ts`)).href;
    return next(specifier, context);
  },
});
const { fitFaceAlignment } = await import('../features/album/face-alignment.ts');
const { parseDetectedPhotoFaces } = await import('../features/album/photo-face-detector.ts');
const { DEFAULT_MATCH_THRESHOLD, matchPairByScores } = await import('../features/album/face-pipeline.ts');
const lossless = process.argv.includes('--lossless');
const target = process.env.AOI_PHONE_TARGET ?? 'com.ekasc.aoi.dev';
const host = process.env.AOI_PHONE_LAN_HOST;
assert(host && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host), 'Set AOI_PHONE_LAN_HOST to this Mac\'s LAN IPv4 address');
const directory = resolve(root, '.expo/face-benchmark/public-groups');
const reportDirectory = resolve(root, '.expo/face-engine-verification');
const manifest = JSON.parse(await readFile(resolve(directory, 'sources.json'), 'utf8'));
assert(manifest.publicFiguresOnly === true && Array.isArray(manifest.images), 'Use the public source ledger');
assert(manifest.images.length > 0 && manifest.images.length <= 12, 'Public parity batch must be bounded');
process.umask(0o077);
await prepareFaceModel(true);
await mkdir(reportDirectory, { recursive: true });
const scratch = await mkdtemp(resolve(reportDirectory, 'public-phone-run-'));
const resources = new Map();
const token = randomUUID();
const helpers = [];
const rows = [];
const references = { mac: [], phone: [] };
let cancelled = false;
const stop = () => { cancelled = true; for (const helper of helpers) void helper.close(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
const lifetime = setTimeout(stop, 8 * 60_000);
const server = createServer((request, response) => {
  const bytes = request.method === 'GET' ? resources.get(request.url) : null;
  if (!bytes) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
  response.end(bytes);
});
const evaluate = async (expression) => {
  const { stdout } = await run(process.execPath, ['scripts/dev-agent.mjs', 'eval', expression, '--target', target, '--timeout', '10000'], { cwd: root, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (result?.ok === false) throw new Error('Phone diagnostic did not complete');
  return result;
};
const normalize = (values) => {
  assert(values.length === 128 && values.every(Number.isFinite), 'Invalid embedding');
  const norm = Math.hypot(...values);
  assert(norm > 0, 'Zero embedding');
  return values.map((value) => value / norm);
};
const cosine = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0) / (Math.hypot(...a) * Math.hypot(...b));
try {
  await copyFile(resolve(root, 'scripts/face-test-native.swift'), resolve(scratch, 'main.swift'));
  await run('xcrun', ['swiftc', '-O', '-module-cache-path', resolve(scratch, 'cache'), resolve(root, 'modules/aoi-face-detector/ios/FacePhoto.swift'), resolve(scratch, 'main.swift'), '-o', resolve(scratch, 'native')], { timeout: 120_000 });
  const native = startFaceHelper(resolve(scratch, 'native'), []); helpers.push(native);
  const inference = startFaceHelper(resolve(root, '.expo/face-reference-venv/bin/python'), [resolve(root, 'scripts/face-test-inference.py'), resolve(root, 'assets/models/sface.onnx')]); helpers.push(inference);
  const nativeInfo = await native.ready; await inference.ready;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, host, done); });
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://${host}:${address.port}`;
  for (let index = 0; index < manifest.images.length; index++) {
    assert(!cancelled, 'Public parity check cancelled');
    const source = manifest.images[index];
    assert(typeof source.file === 'string' && typeof source.source === 'string' && source.source.startsWith('https://commons.wikimedia.org/'), 'Invalid public source');
    const path = resolve(directory, source.file);
    assert(path.startsWith(`${directory}/`), 'Source escaped public catalogue');
    let bytes = await readFile(path);
    assert(bytes.length <= 8 * 1024 * 1024, 'Public image exceeds parity limit');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, 'Public input checksum mismatch');
    let testPath = path;
    if (lossless) {
      testPath = resolve(scratch, `public-${index}.png`);
      await run(resolve(root, '.expo/face-reference-venv/bin/python'), ['-B', '-c', 'import cv2,sys; cv2.setNumThreads(1); image=cv2.imread(sys.argv[1]); assert image is not None; assert cv2.imwrite(sys.argv[2],image)', path, testPath], { timeout: 30_000 });
      bytes = await readFile(testPath);
    }
    const id = `public-${index}`;
    console.log(`${id}: starting Mac detection`);
    resources.set(`/${token}/image`, bytes);
    const uri = pathToFileURL(testPath).href;
    const mac = parseDetectedPhotoFaces((await native.request({ op: 'detect', uri })).value);
    const fixed = [];
    for (const face of mac.faces) {
      if (!face.landmarks) continue;
      const transform = fitFaceAlignment(face.landmarks);
      if (!transform) continue;
      const coefficients = [transform.a, transform.b, transform.tx, transform.ty];
      const pixels = Float32Array.from((await native.request({ op: 'prepare', uri, transform: coefficients })).value);
      const embedding = normalize((await inference.request({ pixels: Array.from(pixels) })).value);
      const key = `/${token}/pixels-${fixed.length}`;
      const binary = Buffer.alloc(pixels.length * 4);
      pixels.forEach((value, offset) => binary.writeFloatLE(value, offset * 4));
      resources.set(key, binary); pixels.fill(0);
      fixed.push({ face, transform: coefficients, embedding, pixelsUrl: `${base}${key}` });
    }
    console.log(`${id}: prepared ${fixed.length} Mac crops; starting phone comparison`);
    const request = { id, url: `${base}/${token}/image`, bytes: bytes.length, filename: `aoi-public-parity-${token}${extname(testPath)}`, fixed: fixed.map(({ face, transform, pixelsUrl }) => ({ face, transform, pixelsUrl })) };
    await evaluate(`(function(){
      if(globalThis.__aoiPublicParityBusy)throw new Error('Another public check is active');
      globalThis.__aoiPublicParityResult={pending:true};
      delete globalThis.__aoiPublicParityCancel;
      (async function(){
      var fs,recognition,native;
      globalThis.__r.getModules().forEach(function(m){
        var e=m.publicModule.exports;
        if(m.verboseName==='features/album/local-face-recognition.native.ts')recognition=e;
        if(m.verboseName&&m.verboseName.includes('expo-file-system')&&m.verboseName.endsWith('/src/index.ts'))fs=e;
        if(m.verboseName&&m.verboseName.endsWith('/expo/src/Expo.ts')&&e.requireOptionalNativeModule)native=e.requireOptionalNativeModule('AoiFaceDetector');
      });
      if(!fs||!recognition||!native)throw new Error('Open Us before the public check');
      var request=${JSON.stringify(request)},file=new fs.File(fs.Paths.cache,request.filename),engine=recognition.createLocalFaceRecognition(),outputs=[],own=[],result;
      globalThis.__aoiPublicParityBusy=true;
      try{
        var response=await fetch(request.url);
        if(!response.ok)throw new Error('Public fixture transfer failed');
        var bytes=new Uint8Array(await response.arrayBuffer());
        if(bytes.length!==request.bytes)throw new Error('Public fixture length mismatch');
        file.write(bytes);bytes.fill(0);
        if(!await engine.isAvailable())throw new Error('Phone recognition unavailable');
        for(var item of request.fixed){
          if(globalThis.__aoiPublicParityCancel)throw new Error('Public check cancelled');
          var pixels=await native.prepareFace(file.uri,item.transform),expectedResponse=await fetch(item.pixelsUrl);
          if(!expectedResponse.ok)throw new Error('Crop reference transfer failed');
          var expected=new DataView(await expectedResponse.arrayBuffer()),maxPixelError=0,totalPixelError=0;
          if(pixels.length!==3*112*112||expected.byteLength!==pixels.length*4)throw new Error('Crop tensor shape mismatch');
          for(var i=0;i<pixels.length;i++){
            if(!Number.isFinite(pixels[i]))throw new Error('Nonfinite crop pixel');
            var difference=Math.abs(pixels[i]-expected.getFloat32(i*4,true));
            maxPixelError=Math.max(maxPixelError,difference);totalPixelError+=difference;
          }
          pixels.fill(0);new Uint8Array(expected.buffer).fill(0);
          var embedding=await engine.embed(file.uri,item.face);
          outputs.push({embedding:Array.from(embedding),maxPixelError:maxPixelError,meanPixelError:totalPixelError/pixels.length});embedding.fill(0);
        }
        var faces=await engine.detect(file.uri);
        for(var face of faces){
          if(globalThis.__aoiPublicParityCancel)throw new Error('Public check cancelled');
          if(!face.landmarks){own.push({face:face,embedding:null});continue;}
          var embedding=await engine.embed(file.uri,face);
          own.push({face:face,embedding:Array.from(embedding)});embedding.fill(0);
        }
        result={fixed:outputs,own:own};
      }finally{
        try{if(file.exists)file.delete();await engine.dispose();}
        finally{delete globalThis.__aoiPublicParityBusy;}
      }
      if(file.exists)throw new Error('Public scratch photo was not removed');
      result.scratchRemoved=true;return result;
      })().then(function(result){globalThis.__aoiPublicParityResult=result;},function(){globalThis.__aoiPublicParityResult={error:'Public phone processing failed'};});
      return {started:true};
    })()`);
    let phone;
    const deadline = Date.now() + 120_000;
    do {
      assert(!cancelled, 'Public parity check cancelled');
      await new Promise((done) => setTimeout(done, 500));
      phone = await evaluate('globalThis.__aoiPublicParityResult');
    } while (phone?.pending && Date.now() < deadline);
    assert(phone && !phone.pending && !phone.error, 'Public phone processing failed or timed out');
    await evaluate('delete globalThis.__aoiPublicParityResult');
    assert(phone.scratchRemoved === true && phone.fixed.length === fixed.length, 'Incomplete phone result/cleanup');
    const macEmbeddings = fixed.map((item) => [...item.embedding]);
    const phoneEmbeddings = phone.own.filter((item) => item.embedding).map((item) => normalize(item.embedding));
    let pairDecisions;
    if (source.role === 'reference') {
      assert.equal(macEmbeddings.length, 1, 'Public reference must have one usable Mac face');
      assert.equal(phoneEmbeddings.length, 1, 'Public reference must have one usable phone face');
      assert.equal(references.mac.length, references.phone.length);
      assert(references.mac.length < 2, 'Only two primary public references are expected');
      references.mac.push([...macEmbeddings[0]]); references.phone.push([...phoneEmbeddings[0]]);
    } else if (source.role === 'both') {
      assert.equal(references.mac.length, 2, 'Primary public references missing');
      const score = (embeddings, prints) => embeddings.map((embedding) => ({ you: cosine(embedding, prints[0]), partner: cosine(embedding, prints[1]) }));
      const macScores = score(macEmbeddings, references.mac), phoneScores = score(phoneEmbeddings, references.phone);
      pairDecisions = { mac: matchPairByScores(macScores, DEFAULT_MATCH_THRESHOLD), phone: matchPairByScores(phoneScores, DEFAULT_MATCH_THRESHOLD), macScores, phoneScores };
    }
    const comparisons = fixed.map((reference, i) => {
      const actual = phone.fixed[i];
      const similarity = cosine(normalize(actual.embedding), reference.embedding);
      const maxEmbeddingError = Math.max(...actual.embedding.map((value, j) => Math.abs(value - reference.embedding[j])));
      actual.embedding.fill(0); reference.embedding.fill(0);
      return { cosine: similarity, maxEmbeddingError, maxPixelError: actual.maxPixelError, meanPixelError: actual.meanPixelError };
    });
    const ownComparisons = [];
    for (const item of phone.own) {
      if (!item.embedding) continue;
      const transform = fitFaceAlignment(item.face.landmarks);
      assert(transform, 'Phone face alignment failed');
      const pixels = Float32Array.from((await native.request({ op: 'prepare', uri, transform: [transform.a, transform.b, transform.tx, transform.ty] })).value);
      const embedding = normalize((await inference.request({ pixels: Array.from(pixels) })).value);
      ownComparisons.push({ cosine: cosine(normalize(item.embedding), embedding) });
      pixels.fill(0); item.embedding.fill(0); embedding.fill(0);
    }
    for (const embedding of [...macEmbeddings, ...phoneEmbeddings]) embedding.fill(0);
    rows.push({ id, role: source.role, macDetected: mac.faces.length, phoneDetected: phone.own.length, fixedLandmarkComparisons: comparisons, phoneLandmarkComparisons: ownComparisons, pairDecisions, scratchRemoved: true });
    await writeFile(resolve(reportDirectory, `phone-public${lossless ? '-lossless' : ''}-progress.json`), JSON.stringify({ complete: false, rows }, null, 2), { mode: 0o600 });
    console.log(`${id}: Mac ${mac.faces.length}, phone ${phone.own.length}; ${comparisons.length} fixed crops compared`);
    for (const buffer of resources.values()) buffer.fill(0);
    resources.clear();
  }
  const passed = rows.every((row) => row.fixedLandmarkComparisons.every((item) => item.cosine >= 0.9999 && item.maxEmbeddingError <= 0.001 && item.maxPixelError <= 8) && row.phoneLandmarkComparisons.every((item) => item.cosine >= 0.9999));
  const report = { target, native: nativeInfo, publicOnly: true, losslessReencodedControls: lossless, sourceLedger: '.expo/face-benchmark/public-groups/sources.json', personalPhotosAccessed: false, recognitionAccuracyEstablished: false, thresholdChanged: false, threshold: DEFAULT_MATCH_THRESHOLD, rows, preprocessingParityPassed: passed };
  await writeFile(resolve(reportDirectory, `phone-public${lossless ? '-lossless' : ''}-results.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
  assert(passed, 'Real public-photo preprocessing/inference parity failed; inspect report');
  console.log('Public-photo crop and embedding parity passed. Identity accuracy is not established.');
} finally {
  clearTimeout(lifetime);
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  try { await evaluate("if(globalThis.__aoiPublicParityBusy)globalThis.__aoiPublicParityCancel=true;else {delete globalThis.__aoiPublicParityResult;delete globalThis.__aoiPublicParityCancel;}"); }
  catch { /* A disconnected phone's asynchronous job still owns its cache-file cleanup. */ }
  await Promise.all(helpers.map((helper) => helper.close()));
  if (server.listening) await new Promise((done) => { server.close(done); server.closeAllConnections(); });
  for (const buffer of resources.values()) buffer.fill(0);
  for (const embedding of [...references.mac, ...references.phone]) embedding.fill(0);
  resources.clear();
  await rm(scratch, { recursive: true, force: true });
}
