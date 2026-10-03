import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readFaceDataset, faceTestHtml } from '../../../scripts/test-face-recognition.mjs';
import { startFaceHelper } from '../../../scripts/face-test-process.mjs';

async function dataset() {
  const directory = await mkdtemp(join(tmpdir(), 'aoi-mac-face-test-'));
  await mkdir(join(directory, 'both')); await mkdir(join(directory, 'not-both'));
  await writeFile(join(directory, 'you.jpg'), 'reference-1'); await writeFile(join(directory, 'partner.HEIC'), 'reference-2');
  await writeFile(join(directory, 'both', 'pair.jpg'), 'pair'); await writeFile(join(directory, 'not-both', 'solo.png'), 'solo');
  return directory;
}

describe('local test-folder and private report boundaries', () => {
  it('labels folders and excludes references and duplicate file contents', async () => {
    const directory = await dataset();
    try {
      await writeFile(join(directory, 'both', 'same-reference.jpg'), 'reference-1');
      await writeFile(join(directory, 'not-both', 'duplicate.jpg'), 'pair');
      const value = await readFaceDataset(directory);
      expect(value.photos).toHaveLength(2); expect(value.excluded).toHaveLength(2);
      expect(value.photos.map((photo) => photo.bothPresent)).toEqual([true, false]);
      expect(value.references.partner).toContain('partner.HEIC');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('rejects empty negative tests instead of reporting a misleading zero false-positive rate', async () => {
    const directory = await dataset();
    try {
      await rm(join(directory, 'not-both', 'solo.png'));
      await expect(readFaceDataset(directory)).rejects.toThrow('at least one test photo to not-both');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('escapes filenames and does not embed photos or vectors in the HTML report', () => {
    const html = faceTestHtml({ found: 1, missed: 0, incorrectMatches: 0, rejected: 0, failed: 0, threshold: 0.72 },
      [{ id: 'photo-1', outcome: 'found', reason: '<script>bad</script>' }],
      { photos: [{ id: 'photo-1', file: '/private/test.jpg', name: '<img onerror="bad">.jpg' }], excluded: [] });
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img ');
    expect(html).toContain("default-src 'none'"); expect(html).toContain('not proof of production accuracy');
  });
});

describe('bounded native/inference process ownership', () => {
  it('performs serialized requests and verifies the helper is dead after teardown', async () => {
    const helper = startFaceHelper(process.execPath, ['--input-type=module', '-e', `import {createInterface} from 'node:readline'; console.log(JSON.stringify({ready:true})); createInterface({input:process.stdin}).on('line',()=>console.log(JSON.stringify({value:process.pid})));`]);
    let pid;
    try { await helper.ready; pid = (await helper.request({ op: 'test' })).value; }
    finally { await helper.close(); }
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it('cleans up startup failures and timed-out requests', async () => {
    const missing = startFaceHelper('/aoi-nonexistent-helper', []);
    try { await expect(missing.ready).rejects.toThrow('stopped unexpectedly'); }
    finally { await missing.close(); }
    const helper = startFaceHelper(process.execPath, ['--input-type=module', '-e', `console.log(JSON.stringify({ready:true})); process.stdin.resume();`], { timeoutMs: 300 });
    try { await helper.ready; await expect(helper.request({ op: 'hang' })).rejects.toThrow('timed out'); }
    finally { await helper.close(); }
  });
});
