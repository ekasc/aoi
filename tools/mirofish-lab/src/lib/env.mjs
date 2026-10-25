import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { labPaths } from './paths.mjs';

/**
 * Load .env files into process.env without printing values.
 *
 * Existing environment variables win. This mirrors how Aoi's Expo tooling
 * loads .env, but it is intentionally a small parser rather than a shell
 * source: a .env file should not execute code.
 */
export function loadEnvFile(path, { override = false } = {}) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const loaded = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
      if (rawValue.trim().startsWith('"')) {
        value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
    } else {
      const comment = value.search(/\s#/);
      if (comment !== -1) value = value.slice(0, comment).trim();
    }
    if (!override && process.env[key] !== undefined) continue;
    process.env[key] = value;
    loaded.push(key);
  }
  return loaded;
}

/** Load the repo .env and an optional lab-local .env. Returns file names and key names only. */
export function loadLabEnv() {
  const paths = labPaths();
  const candidates = [
    join(paths.repoRoot, '.env'),
    join(paths.repoRoot, '.env.local'),
    join(paths.labRoot, '.env'),
    join(paths.labRoot, '.env.local'),
  ];
  const files = [];
  const keys = [];
  for (const file of candidates) {
    const loaded = loadEnvFile(file);
    if (loaded.length > 0) {
      files.push(file.replace(`${paths.repoRoot}/`, ''));
      keys.push(...loaded);
    }
  }
  if (!process.env.LLM_API_KEY && process.env.OPENCODE_KEY) {
    process.env.LLM_API_KEY = process.env.OPENCODE_KEY;
  }
  if (!process.env.OPENCODE_GO_API_KEY && process.env.OPENCODE_KEY) {
    process.env.OPENCODE_GO_API_KEY = process.env.OPENCODE_KEY;
  }
  return { files, keys: [...new Set(keys)] };
}

/** The OpenCode Go key from .env or the shell. Never return a non-OpenCode LLM key as if it were one. */
export function openCodeKey() {
  return (
    process.env.OPENCODE_KEY ??
    process.env.OPENCODE_GO_API_KEY ??
    (process.env.LLM_BASE_URL?.includes('opencode.ai') ? process.env.LLM_API_KEY : undefined) ??
    null
  );
}

/** Any usable model key. */
export function modelKey() {
  return openCodeKey() ?? process.env.LLM_API_KEY ?? process.env.LAB_LLM_API_KEY ?? null;
}
