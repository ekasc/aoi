#!/usr/bin/env node
/**
 * Local-only labeller for the private real-photo evaluation dataset.
 *
 * It reads only the directory you pass with --source. It never scans Photos or
 * any other directory. The server binds to 127.0.0.1, makes no outbound network
 * request, has no analytics, and serves only the selected images. State lives
 * under gitignored .expo/face-lab/.
 *
 *   node scripts/label-private-face-eval.mjs --source /path/to/exported/photos
 *
 * Keys: 1 positive, 2 solo-a, 3 solo-b, 4 negative, 5 groups,
 *       a reference A, b reference B, s skip, r reference help,
 *       left/right previous and next.
 */

import { spawn, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { copyFile, link, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadLabellingState, scanDataset, sha256File } from './face-eval-dataset.mjs';
import { loadAppModules } from './test-face-recognition.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE_ROOT = join(root, '.expo/face-lab');
const DATASET_ROOT = join(PRIVATE_ROOT, 'private-eval');
const STATE_PATH = join(PRIVATE_ROOT, 'label-state.json');
const THUMB_ROOT = join(PRIVATE_ROOT, 'label-thumbs');

const USAGE = `Local-only labeller for the private face-eval dataset.

Usage:
  node scripts/label-private-face-eval.mjs --source <directory> [options]

Options:
  --source <directory>  the only directory this tool reads (required)
  --recursive           include subdirectories of the source (default: top level only)
  --limit <n>           sample at most n photos when starting a new session
  --seed <n>            deterministic sampling seed (default 1)
  --spread              sample evenly across capture dates instead of a seeded shuffle
  --port <n>            localhost port, 0 picks a free one (default 8787)
  --open                open the page in the default browser
  --reset               discard any saved session for this source and start over
  --validate            print dataset validation and exit, no server
  --help

Keys: 1 positive, 2 solo-a, 3 solo-b, 4 negative, 5 groups,
      a reference A, b reference B, s skip, r reference help,
      left/right previous and next.`;

function parseArgs(args) {
  const options = { source: null, recursive: false, limit: null, seed: 1, spread: false, port: 8787, open: false, reset: false, validate: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--source') options.source = args[++index];
    else if (value === '--recursive') options.recursive = true;
    else if (value === '--limit') options.limit = Number(args[++index]);
    else if (value === '--seed') options.seed = Number(args[++index]);
    else if (value === '--spread') options.spread = true;
    else if (value === '--port') options.port = Number(args[++index]);
    else if (value === '--open') options.open = true;
    else if (value === '--reset') options.reset = true;
    else if (value === '--validate') options.validate = true;
    else if (value === '--help' || value === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

async function indexSource(sourceRoot, recursive, isSupportedImage) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) { if (recursive) await walk(full); }
      else if (entry.isFile() && isSupportedImage(entry.name)) files.push(full);
    }
  }
  await walk(sourceRoot);
  return files.sort();
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif', '.tif': 'image/tiff', '.tiff': 'image/tiff' };

async function thumbnailFor(sample, sourceRoot) {
  const destination = join(THUMB_ROOT, `${sample.id}.jpg`);
  if (existsSync(destination)) return destination;
  await mkdir(THUMB_ROOT, { recursive: true, mode: 0o700 });
  const source = join(sourceRoot, sample.source);
  const result = spawnSync('sips', ['-Z', '640', '-s', 'format', 'jpeg', source, '--out', destination], { stdio: 'ignore' });
  return result.status === 0 && existsSync(destination) ? destination : null;
}

function pageHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Private face-eval labeller</title>
<style>
:root{color-scheme:dark}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#141414;color:#eee}
header{padding:10px 16px;background:#1e1e1e;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header b{color:#8fd}
main{display:flex;gap:16px;padding:16px;flex-wrap:wrap}
.stage{flex:1 1 620px;min-width:320px;display:flex;flex-direction:column;align-items:center;gap:10px}
img{max-width:100%;max-height:72vh;background:#000;border-radius:8px;object-fit:contain}
.side{flex:0 0 260px}
button{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid #444;background:#222;color:#eee;cursor:pointer}
button.active{background:#2d6;color:#041;border-color:#2d6}
button:focus-visible{outline:2px solid #8fd;outline-offset:2px}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
table{width:100%;border-collapse:collapse}td{padding:2px 4px;border-bottom:1px solid #2a2a2a}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#2a2a2a}
kbd{background:#2a2a2a;border:1px solid #444;border-radius:4px;padding:0 5px}
small{color:#aaa}
</style></head><body>
<header>
  <b>Local-only</b>
  <span id="progress">loading</span>
  <span class="pill" id="current">unlabelled</span>
  <span id="refmode" hidden class="pill">reference mode: press a or b</span>
  <small id="source"></small>
</header>
<main>
  <section class="stage">
    <img id="photo" alt="Selected photo" />
    <div class="row">
      <button id="prev">← Prev</button>
      <button id="next">Next →</button>
      <button id="skip">Skip (s)</button>
    </div>
  </section>
  <aside class="side">
    <div class="row">
      <button data-label="positive">1 positive</button>
      <button data-label="solo-a">2 solo-a</button>
      <button data-label="solo-b">3 solo-b</button>
      <button data-label="negative">4 negative</button>
      <button data-label="groups">5 groups</button>
    </div>
    <div class="row">
      <button data-ref="A">a ref A</button>
      <button data-ref="B">b ref B</button>
    </div>
    <table id="counts"></table>
    <p><small>Source: <span id="srcpath"></span><br>Destination: <span id="dstpath"></span></small></p>
    <p><small>Keys: <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><kbd>5</kbd> categories, <kbd>a</kbd>/<kbd>b</kbd> references, <kbd>s</kbd> skip, <kbd>r</kbd> reference help, <kbd>←</kbd><kbd>→</kbd> navigate.</small></p>
  </aside>
</main>
<script>
var samples = [], index = 0, meta = null;
function el(id){return document.getElementById(id);}
function describe(a){if(!a)return 'unlabelled';if(a.kind==='reference')return 'reference '+a.person;return a.category;}
function render(){
  if(!samples.length){el('progress').textContent='no photos';el('photo').removeAttribute('src');return;}
  var s=samples[index];
  el('progress').textContent=(index+1)+' / '+samples.length+'  ('+(meta?meta.unlabelled:'?')+' unlabelled)';
  el('current').textContent=describe(s.assignment);
  el('photo').src='/thumb/'+encodeURIComponent(s.id);
  el('prev').disabled=index===0; el('next').disabled=index>=samples.length-1;
}
async function refresh(){
  var res=await fetch('/api/samples'); var payload=await res.json();
  samples=payload.samples; meta=payload.counts; el('source').textContent='source '+payload.sourceRoot; el('srcpath').textContent=payload.sourceRoot; el('dstpath').textContent=payload.datasetRoot;
  renderCounts(payload.counts);
  render();
}
function renderCounts(c){
  var rows=[['positive',c.categories.positive],['solo-a',c.categories['solo-a']],['solo-b',c.categories['solo-b']],['negative',c.categories.negative],['groups',c.categories.groups],['ref A',c.referencesA],['ref B',c.referencesB],['unlabelled',c.unlabelled]];
  el('counts').innerHTML=rows.map(function(r){return '<tr><td>'+r[0]+'</td><td style="text-align:right">'+r[1]+'</td></tr>';}).join('');
}
async function assign(assignment){
  if(!samples.length)return;
  var s=samples[index];
  var res=await fetch('/api/label',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:s.id,assignment:assignment})});
  if(!res.ok){alert('Label failed');return;}
  var payload=await res.json(); s.assignment=assignment; renderCounts(payload.counts); render();
  if(index<samples.length-1){index+=1;render();}
}
function move(delta){index=Math.max(0,Math.min(samples.length-1,index+delta));render();}
document.addEventListener('keydown',function(e){
  if(e.target&&/input|textarea/i.test(e.target.tagName))return;
  var k=e.key;
  if(k==='1')return assign({kind:'category',category:'positive'});
  if(k==='2')return assign({kind:'category',category:'solo-a'});
  if(k==='3')return assign({kind:'category',category:'solo-b'});
  if(k==='4')return assign({kind:'category',category:'negative'});
  if(k==='5')return assign({kind:'category',category:'groups'});
  if(k==='a'||k==='A')return assign({kind:'reference',person:'A'});
  if(k==='b'||k==='B')return assign({kind:'reference',person:'B'});
  if(k==='s'||k==='S')return assign(null);
  if(k==='r'||k==='R'){el('refmode').hidden=!el('refmode').hidden;return;}
  if(k==='ArrowLeft'){e.preventDefault();return move(-1);}
  if(k==='ArrowRight'){e.preventDefault();return move(1);}
});
el('prev').onclick=function(){move(-1);};
el('next').onclick=function(){move(1);};
el('skip').onclick=function(){assign(null);};
Array.prototype.forEach.call(document.querySelectorAll('[data-label]'),function(button){button.onclick=function(){assign({kind:'category',category:button.getAttribute('data-label')});};});
Array.prototype.forEach.call(document.querySelectorAll('[data-ref]'),function(button){button.onclick=function(){assign({kind:'reference',person:button.getAttribute('data-ref')});};});
refresh();
</script></body></html>`;
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 1e6) { rejectPromise(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolvePromise(JSON.parse(data || '{}')); } catch { rejectPromise(new Error('Invalid JSON')); } });
    req.on('error', rejectPromise);
  });
}

export async function main(args) {
  const options = parseArgs(args);
  if (options.help) { console.log(USAGE); return; }
  loadAppModules();
  const {
    applyAssignment, createLabellingState, datasetDestination,
    labellingCounts, parseLabellingState, selectSamples, validateDataset,
  } = await import('../features/face-index/labelling.ts');
  const { isSupportedImage } = await import('../features/face-index/private-eval.ts');

  await mkdir(DATASET_ROOT, { recursive: true, mode: 0o700 });
  await mkdir(PRIVATE_ROOT, { recursive: true, mode: 0o700 });

  const validationFor = async (state) => {
    const entries = await scanDataset(DATASET_ROOT, isSupportedImage);
    return validateDataset({ entries, state });
  };

  if (options.validate) {
    const state = await loadLabellingState(STATE_PATH, parseLabellingState);
    const validation = await validationFor(state);
    console.log(JSON.stringify({ unlabelled: validation.unlabelled, counts: validation.counts, duplicates: validation.duplicates.length, leakage: validation.leakage.length, warnings: validation.warnings }, null, 2));
    return;
  }

  if (!options.source) { console.log(USAGE); return; }
  const sourceRoot = resolve(options.source);
  const info = await stat(sourceRoot).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`--source must be an existing directory: ${sourceRoot}`);

  let state = options.reset ? null : await loadLabellingState(STATE_PATH, parseLabellingState);
  if (state && state.sourceRoot !== sourceRoot) { console.log('Saved session is for a different source. Starting a new one.'); state = null; }

  if (!state) {
    const files = await indexSource(sourceRoot, options.recursive, isSupportedImage);
    const seen = new Set();
    const all = [];
    let duplicateCount = 0;
    for (const file of files) {
      const hash = await sha256File(file);
      if (seen.has(hash)) { duplicateCount += 1; continue; }
      seen.add(hash);
      const fileInfo = await stat(file);
      all.push({ id: hash, source: relative(sourceRoot, file), bytes: fileInfo.size, mtimeMs: fileInfo.mtimeMs, assignment: null, dest: null, updatedAt: null });
    }
    const selected = selectSamples(all, { limit: options.limit ?? undefined, seed: options.seed, spread: options.spread });
    state = createLabellingState({ sourceRoot, samples: selected, now: new Date().toISOString(), duplicateCount });
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
    console.log(`Indexed ${files.length} files, ${all.length} unique, sampled ${selected.length}, ${duplicateCount} duplicate(s) skipped.`);
  } else {
    console.log(`Resumed session with ${state.samples.length} sampled photos.`);
  }

  const byId = new Map(state.samples.map((sample) => [sample.id, sample]));
  let validationCache = null;
  let labelQueue = Promise.resolve();

  const applyAndPersist = async (id, assignment) => {
    const sample = byId.get(id);
    if (!sample) throw new Error('Unknown sample');
    // A reference must not also sit in the evaluation set: applyAssignment replaces
    // the single assignment, and the previous dataset file is removed first.
    if (sample.dest) await rm(join(DATASET_ROOT, sample.dest), { force: true });
    let dest = null;
    if (assignment) {
      const target = datasetDestination({ assignment, hash: sample.id, source: sample.source });
      dest = `${target.folder}/${target.name}`;
      const absolute = join(DATASET_ROOT, dest);
      await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
      if (!existsSync(absolute)) {
        try { await link(join(sourceRoot, sample.source), absolute); }
        catch { await copyFile(join(sourceRoot, sample.source), absolute); }
      }
    }
    state = applyAssignment(state, id, assignment, new Date().toISOString(), dest);
    byId.set(id, state.samples.find((entry) => entry.id === id));
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
    validationCache = null;
    return labellingCounts(state);
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/') {
        const html = pageHtml();
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html), 'cache-control': 'no-store' });
        res.end(html);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/samples') {
        sendJson(res, 200, {
          sourceRoot,
          datasetRoot: DATASET_ROOT,
          counts: labellingCounts(state),
          samples: state.samples.map((sample) => ({ id: sample.id, source: sample.source, assignment: sample.assignment })),
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/validate') {
        if (!validationCache) validationCache = await validationFor(state);
        sendJson(res, 200, validationCache);
        return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/thumb/')) {
        const id = decodeURIComponent(url.pathname.slice('/thumb/'.length));
        const sample = byId.get(id);
        if (!sample) { sendJson(res, 404, { error: 'unknown sample' }); return; }
        const thumbnail = await thumbnailFor(sample, sourceRoot);
        const file = thumbnail ?? join(sourceRoot, sample.source);
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': body.length, 'cache-control': 'no-store' });
        res.end(body);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/label') {
        const body = await readBody(req);
        if (!body || typeof body.id !== 'string') { sendJson(res, 400, { error: 'id required' }); return; }
        labelQueue = labelQueue.then(() => applyAndPersist(body.id, body.assignment ?? null)).catch(() => {});
        await labelQueue;
        sendJson(res, 200, { counts: labellingCounts(state) });
        return;
      }
      sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : 'request failed' });
    }
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(options.port, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  const url = `http://127.0.0.1:${port}/`;
  console.log('Local-only labeller. No network requests leave this machine.');
  console.log(`  source:      ${sourceRoot}`);
  console.log(`  destination: ${DATASET_ROOT}`);
  console.log(`  state:       ${STATE_PATH} (gitignored)`);
  console.log(`  listening:   ${url}`);
  if (options.open && process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Labeller did not finish.');
    process.exitCode = 1;
  });
}
