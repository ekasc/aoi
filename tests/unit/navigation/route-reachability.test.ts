import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Reachability guard.
 *
 * Every screen under `app/(app)` must be reachable from somewhere in the app
 * (a `router.push` / `href` / `pathname`), or be listed as intentionally
 * deep-link-only. This test derives the orphan set and pins it, so a new
 * screen that nobody links fails here instead of shipping as a dead route.
 *
 * Fixing a finding is a one-line change to EXPECTED_ORPHANS: either wire the
 * screen (the entry disappears) or delete it. The list should trend to empty.
 */

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, 'app');
const SOURCE_DIRS = ['app', 'components', 'features'];

// Entered from the tab bar or root redirects — no push required.
const TAB_OR_ROOT = new Set(['', 'plans', 'together', 'ours', 'memories']);

function walk(dir: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      out.push(...walk(full, accept));
    } else if (accept(full)) {
      out.push(full);
    }
  }
  return out;
}

/** Route segments with expo-router groups and a trailing `index` removed. */
function routePath(file: string): string {
  let rel = path.relative(APP_DIR, file).replace(/\.tsx$/, '');
  rel = rel
    .split('/')
    .filter((segment) => !segment.startsWith('('))
    .join('/');
  if (rel.endsWith('/index')) rel = rel.slice(0, -'/index'.length);
  if (rel === 'index') rel = '';
  return rel;
}

function navigationStrings(): string[] {
  const strings = new Set<string>();
  for (const dir of SOURCE_DIRS) {
    for (const file of walk(path.join(ROOT, dir), (f) => /\.(ts|tsx)$/.test(f))) {
      const text = readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        if (!/push\(|navigate\(|replace\(|href=|pathname:/.test(line)) continue;
        for (const match of line.matchAll(/['"`]([^'"`]*\/[^'"`]*)['"`]/g)) {
          strings.add(match[1]);
        }
      }
    }
  }
  return [...strings];
}

function orphanRoutes(): string[] {
  const nav = navigationStrings();
  const files = walk(APP_DIR, (f) => f.endsWith('.tsx'))
    .filter((f) => !f.endsWith('_layout.tsx'))
    .filter((f) => f.includes(`(app)`))
    .filter((f) => !path.basename(f).startsWith('dev-'))
    .filter((f) => !f.includes(`(public)`) && !f.includes(`(auth)`));

  return files
    .map((file) => ({ file, route: routePath(file) }))
    .filter(({ route }) => !TAB_OR_ROOT.has(route))
    // Dynamic routes (`[id]`) are always pushed with params; static matching
    // would produce noise, so they are out of scope here.
    .filter(({ route }) => !route.includes('['))
    .filter(({ route }) => !nav.some((s) => s.includes(`/${route}`)))
    .map(({ file }) => path.relative(ROOT, file))
    .sort();
}

/**
 * Screens with no inbound navigation by design:
 *  - `settings` / `profile`: legacy deep links that redirect into Space.
 *  - `moment/trace`: legacy capture deep links that forward to the composer.
 *  - `album/check-photo`: legacy recognition deep link that redirects into
 *    Together without importing a scanner.
 *  - `partner` / `question`: the about and reflection surfaces were retired
 *    from the UI on purpose and nothing links to them. Delete the files to
 *    clear these two.
 *
 * Everything else here is a real orphan and should be wired or deleted.
 */
const DEEP_LINK_ONLY = [
  'app/(app)/settings.tsx',
  'app/(app)/moment/trace.tsx',
  'app/(app)/album/check-photo.tsx',
  'app/(app)/partner.tsx',
  'app/(app)/question.tsx',
];

const EXPECTED_ORPHANS = [...DEEP_LINK_ONLY].sort();

describe('route reachability', () => {
  it('has no screens beyond the known, intentionally-unreachable set', () => {
    expect(orphanRoutes()).toEqual(EXPECTED_ORPHANS);
  });
});
