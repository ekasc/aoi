import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Dataset folders the private evaluator reads. */
export const DATASET_FOLDERS = ['references', 'positive', 'solo-a', 'solo-b', 'negative', 'groups'];

export async function sha256File(file) {
  const digest = createHash('sha256');
  digest.update(await readFile(file));
  return digest.digest('hex');
}

/** Hash every image in the private dataset, for duplicate and leakage checks. */
export async function scanDataset(datasetRoot, isSupportedImage) {
  const entries = [];
  for (const folder of DATASET_FOLDERS) {
    let files = [];
    try { files = await readdir(join(datasetRoot, folder), { withFileTypes: true }); }
    catch { continue; }
    for (const entry of files) {
      if (!entry.isFile()) continue;
      if (isSupportedImage && !isSupportedImage(entry.name)) continue;
      entries.push({ folder, name: entry.name, hash: await sha256File(join(datasetRoot, folder, entry.name)) });
    }
  }
  return entries;
}

export async function loadLabellingState(statePath, parseLabellingState) {
  try {
    const value = JSON.parse(await readFile(statePath, 'utf8'));
    return parseLabellingState(value);
  } catch { return null; }
}
