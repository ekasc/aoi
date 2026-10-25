import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { listFiles, readJson, writeJson } from './lib/io.mjs';
import { labPaths } from './lib/paths.mjs';
import { gitHead } from './lib/git.mjs';

const ROUTED_OPS = {
  create_space: (route) => route === '/v1/spaces',
  join_space: (route) => route === '/v1/spaces/join',
  invite_partner: (route) => route === '/v1/spaces/current/invite',
  create_memory: (route) => route === '/v1/spaces/current/moments',
  edit_memory: (route) => /^\/v1\/moments\/[^/]+$/.test(route),
  delete_memory: (route) => /^\/v1\/moments\/[^/]+$/.test(route),
  refresh_space: (route) => route === '/v1/spaces/current',
  change_subscription: (route) =>
    route === '/v1/billing/revenuecat/webhook' || route === '/v1/spaces/current/plus',
  reach_storage_limit: (route) => route.startsWith('/v1/media/'),
  restore_from_phrase: (route) => route.startsWith('/v1/album/'),
  replace_device: (route) => route.startsWith('/v1/album/'),
};

const NON_ROUTED_OPS = new Set([
  'switch_account',
  'lose_connection',
  'retry_operation',
  'open_us',
  'open_memories',
  'add_sky_photo',
  'open_plans',
  'open_collection',
]);

function stripRoute(route) {
  return route.split('?')[0].replace(/\$\{[^}]+\}/g, ':id').replace(/[),;'"]+$/, '');
}

function normalizeRoute(route) {
  return stripRoute(route)
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, '/:id')
    .replace(/\/m[0-9]+$/i, '/:id')
    .replace(/\/note-[a-z0-9-]+$/i, '/:id')
    .replace(/\/sess-[a-z0-9-]+$/i, '/:id');
}

function extractRoutes(text) {
  const routes = new Set();
  for (const match of text.matchAll(/['"`](\/v1\/[^'"`\s]+)['"`]/g)) {
    routes.add(normalizeRoute(match[1]));
  }
  for (const match of text.matchAll(/\b(\/v1\/[A-Za-z0-9_:/${}.-]+)/g)) {
    const raw = match[1].replace(/[.,;:]+$/, '');
    if (raw.includes('${')) routes.add(normalizeRoute(raw));
  }
  return [...routes];
}

function extractTestBlocks(file) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const fileRoutes = extractRoutes(text);
  const blocks = [];
  const marker = /^([ \t]*)(?:it|test)(?:\.(?:each|skip|only|todo|concurrent))?\s*\(\s*(['"`])([\s\S]*?)\2/gm;
  const matches = [...text.matchAll(marker)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const line = text.slice(0, start).split('\n').length;
    const body = text.slice(start, end);
    blocks.push({
      file,
      line,
      title: match[3].replace(/\s+/g, ' ').trim(),
      body,
      routes: extractRoutes(body),
      fileRoutes,
      hasAssertion: /\bexpect\s*\(|\bassert\s*\(/.test(body),
    });
  }
  // Some tests use `it.each` tables whose titles are computed; keep a file-level
  // block so route/assertion evidence is not lost, but never cite it as a title.
  if (blocks.length === 0 && /\bexpect\s*\(/.test(text)) {
    blocks.push({
      file,
      line: 1,
      title: '(file-level assertions)',
      body: text,
      routes: extractRoutes(text),
      fileRoutes,
      hasAssertion: true,
    });
  }
  return { blocks, lines };
}

function opMatchesBlock(op, block) {
  const matcher = ROUTED_OPS[op];
  if (!matcher) return NON_ROUTED_OPS.has(op);
  return [...block.routes, ...(block.fileRoutes ?? [])].some((route) => matcher(route));
}

function probeMatchesBlock(probes, block) {
  if (probes.length === 0) return false;
  const haystack = `${block.title}\n${block.body}`.toLowerCase();
  return probes.every((probe) => haystack.includes(probe.toLowerCase()));
}

function countProbeMatches(probes, block) {
  if (probes.length === 0) return 0;
  const haystack = `${block.title}\n${block.body}`.toLowerCase();
  return probes.filter((probe) => haystack.includes(probe.toLowerCase())).length;
}

export function buildTestIndex({ repoRoot = labPaths().repoRoot } = {}) {
  const roots = [
    `${repoRoot}/tests`,
    `${repoRoot}/packages`,
  ];
  const files = [
    ...new Set(
      roots.flatMap((root) =>
        listFiles(root, (file) => /\.(test|spec)\.(ts|tsx|js|mjs)$/.test(file))
      )
    ),
  ].filter((file) => !file.includes('/node_modules/') && !file.includes('/tools/'));

  const blocks = [];
  for (const file of files) {
    blocks.push(...extractTestBlocks(file).blocks);
  }

  const maestroDir = `${repoRoot}/e2e/maestro`;
  const maestro = listFiles(maestroDir, (file) => file.endsWith('.yaml')).map((file) => ({
    file,
    text: readFileSync(file, 'utf8'),
  }));

  return { files, blocks, maestro };
}

export function analyzeCoverage(scenarios, options = {}) {
  const repoRoot = options.repoRoot ?? labPaths().repoRoot;
  const index = options.index ?? buildTestIndex({ repoRoot });
  const internal = options.internal ?? [];
  const internalById = new Map(internal.map((entry) => [entry.id, entry]));
  const results = [];

  for (const scenario of scenarios) {
    const meta = internalById.get(scenario.id);
    const probes = meta?._coverageProbes ?? options.probesById?.[scenario.id] ?? [];
    const routedOps = scenario.actions.map((action) => action.op).filter((op) => ROUTED_OPS[op]);
    const allOps = scenario.actions.map((action) => action.op);
    const evidence = [];
    let bestPartial = 0;

    for (const block of index.blocks) {
      if (!block.hasAssertion) continue;
      const routeOk =
        scenario.execution_target === 'unit' || routedOps.every((op) => opMatchesBlock(op, block));
      const probeOk = probeMatchesBlock(probes, block);
      const probeCount = countProbeMatches(probes, block);
      bestPartial = Math.max(bestPartial, probeCount + (routeOk ? 1 : 0));
      if (routeOk && probeOk) {
        evidence.push(
          `${relative(repoRoot, block.file)}:${block.line} — ${block.title}`
        );
      }
    }

    let maestroMatch = null;
    if (scenario.execution_target === 'native') {
      for (const flow of index.maestro) {
        const haystack = flow.text.toLowerCase();
        const matches = probes.filter((probe) => haystack.includes(probe.toLowerCase())).length;
        if (matches >= Math.max(1, probes.length - 1)) {
          maestroMatch = relative(repoRoot, flow.file);
          break;
        }
      }
    }

    let level;
    let notes;
    if (evidence.length > 0) {
      level = 'covered';
      notes = `Assertion evidence found in ${evidence.length} test block(s), matching all routed operations and scenario probes.`;
    } else if (bestPartial >= 2) {
      level = 'partial';
      notes = `Related assertions or operations exist, but no single test block exercises the full scenario and proves the expected behavior.`;
    } else if (maestroMatch) {
      level = 'partial';
      notes = `A native Maestro flow mentions this area (${maestroMatch}); its selectors and device behavior are unverified here.`;
    } else if (scenario.execution_target === 'native') {
      level = 'not_automatable';
      notes = 'Requires a native device environment; no harness-backed assertion covers this scenario.';
    } else {
      level = 'not_covered';
      notes = 'No test assertion matching the routed operations and behavior probes was found in the checked-in tests.';
    }

    if (scenario.execution_target === 'manual' && level === 'not_covered') {
      level = 'not_automatable';
      notes = 'This is a UX hypothesis about comprehension or visual expectations; the current harness cannot observe it and it needs human validation.';
    }

    const uniqueEvidence = [...new Set(evidence)].slice(0, 12);
    results.push({
      id: scenario.id,
      level,
      evidence: uniqueEvidence,
      notes,
      matchedOps: allOps.filter((op) => routedOps.includes(op) && index.blocks.some((b) => opMatchesBlock(op, b))),
      matchedProbes: probes.filter((probe) =>
        index.blocks.some((b) => b.hasAssertion && b.body.toLowerCase().includes(probe.toLowerCase()))
      ),
    });
  }

  const summary = {
    covered: results.filter((r) => r.level === 'covered').length,
    partial: results.filter((r) => r.level === 'partial').length,
    not_covered: results.filter((r) => r.level === 'not_covered').length,
    not_automatable: results.filter((r) => r.level === 'not_automatable').length,
    invalid: results.filter((r) => r.level === 'invalid').length,
  };

  return {
    schemaVersion: 'aoi-coverage/1',
    aoiCommit: gitHead(repoRoot),
    generatedAt: new Date().toISOString(),
    summary,
    scenarios: results,
  };
}

export function applyCoverage(scenarios, coverage) {
  const byId = new Map(coverage.scenarios.map((entry) => [entry.id, entry]));
  return scenarios.map((scenario) => {
    const result = byId.get(scenario.id);
    if (!result) return scenario;
    return {
      ...scenario,
      existing_test_coverage: result.evidence,
      coverage: {
        level: result.level,
        evidence: result.evidence,
        notes: result.notes,
      },
      ...(scenario.status === 'proposed' && result.level !== 'not_covered'
        ? { status: 'mapped' }
        : {}),
    };
  });
}

export function writeCoverage(coverage, path) {
  writeJson(path, coverage);
}

export function readScenarios(dir) {
  return listFiles(dir, (file) => /\/AOI-SIM-\d{3}\.json$/.test(file))
    .map((file) => readJson(file))
    .sort((a, b) => a.id.localeCompare(b.id));
}
