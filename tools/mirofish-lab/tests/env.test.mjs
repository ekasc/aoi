import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadEnvFile } from '../src/lib/env.mjs';

test('.env parser reads OPENCODE_KEY without printing or executing it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aoi-env-'));
  const file = join(dir, '.env');
  const previous = process.env.OPENCODE_KEY;
  try {
    writeFileSync(
      file,
      [
        '# comment',
        'OPENCODE_KEY="test_key_value"',
        'LLM_MODEL_NAME=deepseek-v4.1-flash',
        'export EMPTY=',
        'not a key value line',
      ].join('\n'),
      'utf8'
    );
    const keys = loadEnvFile(file, { override: true });
    assert.deepEqual(keys.sort(), ['EMPTY', 'LLM_MODEL_NAME', 'OPENCODE_KEY']);
    assert.equal(process.env.EMPTY, '');
    assert.equal(process.env.OPENCODE_KEY, 'test_key_value');
    assert.equal(process.env.LLM_MODEL_NAME, 'deepseek-v4.1-flash');
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_KEY;
    else process.env.OPENCODE_KEY = previous;
    delete process.env.LLM_MODEL_NAME;
    delete process.env.EMPTY;
    rmSync(dir, { recursive: true, force: true });
  }
});
