import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const descriptor = JSON.parse(await readFile(resolve(root, 'features/album/sface-model.json'), 'utf8'));
const target = resolve(root, 'assets/models/sface.onnx');
const sourcePath = `opencv/opencv_zoo/${descriptor.revision}/models/face_recognition_sface`;

export function verifyModelBytes(bytes, expected = descriptor) {
  if (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
    throw new Error('SFace artifact failed size or SHA-256 verification');
  }
}

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Model preparation HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function prepareFaceModel(checkOnly = false) {
  let existing;
  try { existing = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) verifyModelBytes(existing);
  if (checkOnly) {
    if (!existing) throw new Error('Run pnpm run face:model:prepare before bundling recognition');
    const license = await readFile(resolve(root, 'assets/models/SFACE-LICENSE.txt'), 'utf8');
    if (!license.includes('Apache License')) throw new Error('SFace license evidence is missing');
    return;
  }
  const [bytes, license, readme] = await Promise.all([
    existing ?? fetchBytes(`https://media.githubusercontent.com/media/${sourcePath}/${descriptor.file}`),
    fetchBytes(`https://raw.githubusercontent.com/${sourcePath}/LICENSE`),
    fetchBytes(`https://raw.githubusercontent.com/${sourcePath}/README.md`),
  ]);
  verifyModelBytes(bytes);
  if (!license.toString('utf8').includes('Apache License') || !readme.toString('utf8').includes('All files in this directory')) {
    throw new Error('SFace license evidence is missing');
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(resolve(root, 'assets/models/SFACE-LICENSE.txt'), license);
  await writeFile(resolve(root, 'assets/models/SFACE-SOURCE.md'), readme);
  const partial = `${target}.${process.pid}.partial`;
  try {
    await writeFile(partial, bytes);
    await rename(partial, target);
  } finally {
    await unlink(partial).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareFaceModel(process.argv.includes('--check'));
  console.log('Pinned SFace model and license verified.');
}
