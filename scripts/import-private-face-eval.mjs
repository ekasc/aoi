#!/usr/bin/env node
/**
 * Import explicitly supplied local photos into the private face-eval dataset.
 *
 * This never scans the Photos library. It reads only the files or directories
 * you pass with --source. Originals are left untouched. The dataset lives under
 * a gitignored directory and never enters the repository.
 *
 *   node scripts/import-private-face-eval.mjs --status
 *   node scripts/import-private-face-eval.mjs --category positive --source ~/Desktop/couple-pics
 *   node scripts/import-private-face-eval.mjs --category references-a --source a1.jpg --source a2.jpg
 *
 * Categories:
 *   references-a, references-b, positive, solo-a, solo-b, negative, groups
 *
 * Options:
 *   --source <path>   file or directory, repeatable
 *   --recursive       read supplied directories recursively (default: top level only)
 *   --link            hard-link instead of copy when the filesystem allows, else copy
 *   --keep-names      keep a readable base name plus a short hash instead of a hash-only name
 *   --dry-run         list what would be imported and write nothing
 *   --status          print current counts and minimums, import nothing
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, link, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAppModules } from './test-face-recognition.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATASET_ROOT = join(root, '.expo/face-lab/private-eval');

const USAGE = `Import explicitly supplied photos into the private face-eval dataset.

Usage:
  node scripts/import-private-face-eval.mjs --status
  node scripts/import-private-face-eval.mjs --category <name> --source <path> [--source <path> ...]

Categories:
  references-a  -> references/a-<hash>.<ext>
  references-b  -> references/b-<hash>.<ext>
  positive | solo-a | solo-b | negative | groups

Options:
  --source <path>   file or directory, repeatable
  --recursive       read supplied directories recursively (default: top level only)
  --link            hard-link instead of copy when the filesystem allows, else copy
  --keep-names      keep a readable base name plus a short hash instead of a hash-only name
  --dry-run         list what would be imported and write nothing
  --status          print current counts and minimums, import nothing

The dataset root is ${DATASET_ROOT}.
It is gitignored. This script never scans the Photos library, and it refuses a
source that already lives inside the dataset root.`;

function parseArgs(args) {
  const options = { category: null, sources: [], recursive: false, link: false, keepNames: false, dryRun: false, status: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--category') options.category = args[++index];
    else if (value === '--source') options.sources.push(args[++index]);
    else if (value === '--recursive') options.recursive = true;
    else if (value === '--link') options.link = true;
    else if (value === '--keep-names') options.keepNames = true;
    else if (value === '--dry-run') options.dryRun = true;
    else if (value === '--status') options.status = true;
    else if (value === '--help' || value === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

async function listFiles(source, recursive) {
  const info = await stat(source);
  if (info.isFile()) return [source];
  if (!info.isDirectory()) return [];
  const files = [];
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const full = join(source, entry.name);
    if (entry.isFile()) files.push(full);
    else if (entry.isDirectory() && recursive) files.push(...await listFiles(full, true));
  }
  return files;
}

async function sha256(file) {
  const digest = createHash('sha256');
  digest.update(await readFile(file));
  return digest.digest('hex');
}

async function countPlacement(datasetRoot, placement, isSupportedImage) {
  let entries = [];
  try { entries = await readdir(join(datasetRoot, placement.folder), { withFileTypes: true }); }
  catch { return 0; }
  const images = entries.filter((entry) => entry.isFile() && isSupportedImage(entry.name));
  if (!placement.prefix) return images.length;
  return images.filter((entry) => entry.name.startsWith(placement.prefix)).length;
}

async function countsFor(datasetRoot, placements, isSupportedImage) {
  const counts = {};
  for (const [category, placement] of Object.entries(placements)) counts[category] = await countPlacement(datasetRoot, placement, isSupportedImage);
  return counts;
}

function printCounts(counts, minimumReport, allMet) {
  console.log(`Dataset: ${DATASET_ROOT} (gitignored)`);
  console.log('Counts:');
  for (const [category, count] of Object.entries(counts)) console.log(`  ${category.padEnd(14)} ${count}`);
  console.log('Minimums:');
  for (const entry of minimumReport) {
    const missing = entry.met ? '' : `  missing ${entry.minimum - entry.count}`;
    console.log(`  ${entry.category.padEnd(10)} ${String(entry.count).padStart(4)} / ${entry.minimum}${missing}`);
  }
  console.log(allMet ? 'All minimums met.' : 'Minimums not met yet. Negatives matter most; do not pad with trivial ones.');
}

export async function main(args) {
  const options = parseArgs(args);
  if (options.help) { console.log(USAGE); return; }
  loadAppModules();
  const { CATEGORY_PLACEMENT, PRIVATE_EVAL_CATEGORIES, allMinimumsMet, destinationName, isSupportedImage, minimumReport } = await import('../features/face-index/private-eval.ts');

  await mkdir(DATASET_ROOT, { recursive: true, mode: 0o700 });
  for (const folder of new Set(Object.values(CATEGORY_PLACEMENT).map((placement) => placement.folder))) {
    await mkdir(join(DATASET_ROOT, folder), { recursive: true, mode: 0o700 });
  }

  if (options.status) {
    const counts = await countsFor(DATASET_ROOT, CATEGORY_PLACEMENT, isSupportedImage);
    const report = minimumReport(counts);
    printCounts(counts, report, allMinimumsMet(report));
    return;
  }

  if (!options.category || !options.sources.length) { console.log(USAGE); return; }
  if (!PRIVATE_EVAL_CATEGORIES.includes(options.category)) throw new Error(`Unknown category: ${options.category}. Use one of ${PRIVATE_EVAL_CATEGORIES.join(', ')}`);
  const placement = CATEGORY_PLACEMENT[options.category];

  const files = [];
  const rejected = [];
  for (const source of options.sources) {
    const resolved = resolve(source);
    if (!existsSync(resolved)) { rejected.push({ name: source, reason: 'not found' }); continue; }
    const relativeToDataset = relative(DATASET_ROOT, resolved);
    if (!relativeToDataset.startsWith('..') && !isAbsolute(relativeToDataset)) {
      rejected.push({ name: source, reason: 'source is inside the dataset root' });
      continue;
    }
    for (const file of await listFiles(resolved, options.recursive)) {
      if (!isSupportedImage(file)) { rejected.push({ name: basename(file), reason: 'unsupported extension' }); continue; }
      files.push(file);
    }
  }

  const planned = [];
  for (const file of [...files].sort()) {
    const hash = await sha256(file);
    const name = destinationName({ category: options.category, sha256: hash, originalName: basename(file), keepNames: options.keepNames });
    const destination = join(DATASET_ROOT, placement.folder, name);
    planned.push({ file, name, destination, hash, exists: existsSync(destination) });
  }

  if (options.dryRun) {
    console.log(`Would import ${planned.length} file(s) into ${options.category}:`);
    for (const item of planned) console.log(`  ${basename(item.file)} -> ${placement.folder}/${item.name}${item.exists ? ' (already present)' : ''}`);
    for (const item of rejected) console.log(`  rejected: ${item.name} (${item.reason})`);
    return;
  }

  let imported = 0;
  let skipped = 0;
  const manifestPath = join(DATASET_ROOT, 'import-manifest.json');
  let manifest = [];
  try {
    const value = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (Array.isArray(value)) manifest = value;
  } catch { manifest = []; }

  for (const item of planned) {
    if (item.exists) { skipped += 1; continue; }
    if (options.link) {
      try { await link(item.file, item.destination); }
      catch { await copyFile(item.file, item.destination); }
    } else {
      await copyFile(item.file, item.destination);
    }
    manifest.push({ category: options.category, dest: `${placement.folder}/${item.name}`, sourceName: basename(item.file), sha256: item.hash, mode: options.link ? 'link-or-copy' : 'copy' });
    imported += 1;
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });

  console.log(`Imported ${imported}, skipped ${skipped} already present, rejected ${rejected.length}.`);
  for (const item of rejected) console.log(`  rejected: ${item.name} (${item.reason})`);
  const counts = await countsFor(DATASET_ROOT, CATEGORY_PLACEMENT, isSupportedImage);
  const report = minimumReport(counts);
  printCounts(counts, report, allMinimumsMet(report));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Private import did not finish.');
    process.exitCode = 1;
  });
}
