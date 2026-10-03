import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { fitFaceAlignment, SFACE_TEMPLATE, transformFacePoint } from '../features/album/face-alignment.ts';
import { prepareFaceModel } from './prepare-face-model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reports = resolve(root, '.expo/face-engine-verification');
const python = process.env.AOI_FACE_REFERENCE_PYTHON ?? resolve(root, '.expo/face-reference-venv/bin/python');
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? 'Face verification failed');
  process.stdout.write(result.stdout);
};

await prepareFaceModel(true);
await mkdir(reports, { recursive: true });
const directory = await mkdtemp(resolve(reports, 'run-'));
const cases = [
  { name: 'identity', source: { a: 1, b: 0, tx: 0, ty: 0 } },
  { name: 'shift-scale', source: { a: 1.35, b: 0, tx: 25, ty: 12 } },
  { name: 'tilted', source: { a: 1.15, b: 0.3, tx: 40, ty: 10 } },
  { name: 'counter-tilted', source: { a: 1.2, b: -0.4, tx: 20, ty: 45 } },
].map(({ name, source }) => {
  const points = SFACE_TEMPLATE.map((point) => transformFacePoint(point, source));
  const transform = fitFaceAlignment(points);
  if (!transform) throw new Error('Reference fixture has invalid alignment');
  return { name, points, transform };
});
try {
  await writeFile(resolve(directory, 'cases.json'), JSON.stringify(cases));
  run(python, ['scripts/face-reference.py', 'fixtures', directory]);
  const helper = await readFile(resolve(root, 'modules/aoi-face-detector/ios/FacePhoto.swift'), 'utf8');
  const assertions = await readFile(resolve(root, 'scripts/face-reference-native.swift'), 'utf8');
  const script = resolve(directory, 'native-check.swift');
  await writeFile(script, `${helper}\n${assertions}`);
  run('xcrun', ['swift', '-module-cache-path', resolve(directory, 'module-cache'), script, directory,
    resolve(root, 'assets/models/sface.onnx'), resolve(root, 'features/album/sface-model.json')]);
  run(python, ['scripts/face-reference.py', 'compare', directory]);
  await copyFile(resolve(directory, 'cases.json'), resolve(reports, 'cases.json'));
  await copyFile(resolve(directory, 'reference-results.json'), resolve(reports, 'reference-results.json'));
} finally {
  await rm(directory, { recursive: true, force: true });
}
