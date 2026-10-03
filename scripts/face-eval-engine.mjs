import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { prepareFaceModel } from './prepare-face-model.mjs';
import { startFaceHelper } from './face-test-process.mjs';
import { loadAppModules } from './test-face-recognition.mjs';

export { loadAppModules };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, timeout = 300_000) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1' } });
  if (result.error || result.status !== 0) throw new Error('Local tool setup failed. Run node scripts/test-face-recognition.mjs --setup first.');
}

/**
 * Build the real Mac Vision + SFace engine used by both evaluators.
 * The caller must `close()` it; that disposes the model session, stops both
 * helper processes, and removes the compilation scratch directory.
 */
export async function createMacFaceEngine() {
  if (process.platform !== 'darwin') throw new Error('This evaluator needs macOS for the same Apple Vision detector used by Aoi.');
  const python = process.env.AOI_FACE_REFERENCE_PYTHON ?? join(root, '.expo/face-reference-venv/bin/python');
  if (!existsSync(python)) throw new Error('Run node scripts/test-face-recognition.mjs --setup once to prepare local tools.');
  await prepareFaceModel(true);
  loadAppModules();
  const { createFaceRecognitionEngine } = await import('../features/album/face-recognition-engine.ts');
  const { parseDetectedPhotoFaces } = await import('../features/album/photo-face-detector.ts');

  const workspace = join(root, '.expo/face-lab');
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(join(workspace, 'eval-scratch-'));
  await chmod(scratch, 0o700);
  const helpers = [];
  const cleanup = async () => {
    for (const helper of helpers.reverse()) await helper.close();
    await rm(scratch, { recursive: true, force: true });
  };
  try {
    await copyFile(join(root, 'scripts/face-test-native.swift'), join(scratch, 'main.swift'));
    run('xcrun', ['swiftc', '-O', '-module-cache-path', join(scratch, 'module-cache'), join(root, 'modules/aoi-face-detector/ios/FacePhoto.swift'), join(scratch, 'main.swift'), '-o', join(scratch, 'native')]);
    const native = startFaceHelper(join(scratch, 'native'), []); helpers.push(native);
    const inference = startFaceHelper(python, [join(root, 'scripts/face-test-inference.py'), join(root, 'assets/models/sface.onnx')]); helpers.push(inference);
    await native.ready; await inference.ready;
    const engine = createFaceRecognitionEngine({
      detect: async (uri) => parseDetectedPhotoFaces((await native.request({ op: 'detect', uri, modernFallback: true })).value),
      prepare: async (uri, transform) => (await native.request({ op: 'prepare', uri, transform: [transform.a, transform.b, transform.tx, transform.ty] })).value,
      loadSession: async () => ({ embed: async (pixels) => {
        try { return Float32Array.from((await inference.request({ pixels: Array.from(pixels) })).value); }
        finally { pixels.fill(0); }
      }, release: async () => {} }),
    });
    await engine.isAvailable();
    return { engine, root, workspace, async close() { await engine.dispose(); await cleanup(); } };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
