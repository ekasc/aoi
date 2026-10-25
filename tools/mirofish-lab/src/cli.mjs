#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { loadConfig } from './config.mjs';
import { analyzeCoverage, applyCoverage } from './coverage.mjs';
import { executeScenarios } from './execute.mjs';
import { extractAndAnalyze, loadBaseline, loadLatestRun, loadPersonas, loadScenarios, runPipeline } from './pipeline.mjs';
import { buildReport } from './report.mjs';
import { LlmBaselineBlocked, runLlmBaseline } from './baseline-llm.mjs';
import { buildSeeds } from './seed-builder.mjs';
import { LiveBlockedError, preflight } from './simulation-runner.mjs';
import { OasisBlockedError, resolveMirofishHome } from './oasis.mjs';
import { validatePersonas, validateScenarioSet, validateSimulationBundle } from './validate.mjs';
import { readJson, writeJson } from './lib/io.mjs';
import { loadLabEnv, modelKey, openCodeKey } from './lib/env.mjs';
import { labPaths } from './lib/paths.mjs';
import { gitHead, gitIsDirty } from './lib/git.mjs';

loadLabEnv();

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

function print(value) {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
}

function requireOk(name, result) {
  if (!result.ok) {
    process.stderr.write(`${name} failed:\n${result.errors.join('\n')}\n`);
    process.exitCode = 1;
    throw new Error(`${name} validation failed`);
  }
}

function cmdCheck() {
  const paths = labPaths();
  const seedsPath = join(paths.seedsDir, 'manifest.json');
  if (!existsSync(seedsPath)) throw new Error('Seeds are missing. Run `mirofish-lab:seeds`.');
  const manifest = readJson(seedsPath);
  const head = gitHead(paths.repoRoot);
  if (manifest.aoiCommit !== head) {
    throw new Error(
      `Seeds were generated from ${manifest.aoiCommit.slice(0, 8)}, but the checkout is ${head.slice(0, 8)}. Regenerate seeds.`
    );
  }
  const personas = loadPersonas();
  requireOk('personas', validatePersonas(personas));
  const scenarios = loadScenarios();
  const latest = loadLatestRun();
  const oasisRun = latest?.mode === 'oasis';
  requireOk(
    'scenarios',
    validateScenarioSet(scenarios, {
      repoRoot: paths.repoRoot,
      knownPersonas: new Map(personas.personas.map((person) => [person.id, person])),
      minimum: oasisRun ? 1 : 12,
      requireAllGroups: !oasisRun,
    })
  );
  const bundlePath = join(paths.fixturesDir, 'simulation-bundle.dryrun.json');
  const bundle = readJson(bundlePath);
  requireOk(
    'fixture bundle',
    validateSimulationBundle(bundle, {
      knownPersonas: new Set(personas.personas.map((person) => person.id)),
    })
  );
  print({
    ok: true,
    aoiCommit: head,
    aoiDirty: gitIsDirty(paths.repoRoot),
    mirofishCommit: manifest.mirofishCommit,
    seeds: manifest.docs.length,
    personas: personas.personas.length,
    couples: personas.couples.length,
    scenarios: scenarios.length,
    groups: [...new Set(scenarios.map((scenario) => scenario.experiment))].sort(),
  });
}

function cmdSeeds() {
  const result = buildSeeds();
  print({
    ok: true,
    aoiCommit: result.aoiCommit,
    docs: result.docs.length,
    manifest: 'tools/mirofish-lab/seeds/manifest.json',
  });
}

function cmdPersonas() {
  const personas = loadPersonas();
  const validation = validatePersonas(personas);
  print({ ok: validation.ok, errors: validation.errors, personas: personas.personas.length, couples: personas.couples.length });
  if (!validation.ok) process.exitCode = 1;
}

async function cmdRun() {
  const mode = arg('mode', 'auto');
  if (!['auto', 'live', 'dry-run', 'oasis'].includes(mode)) throw new Error('--mode must be auto, live, dry-run, or oasis');
  const roundsArg = arg('rounds');
  const repeatArg = arg('repeat');
  const rounds = typeof roundsArg === 'string' ? Number(roundsArg) : undefined;
  const repeat = typeof repeatArg === 'string' ? Number(repeatArg) : undefined;
  const couplesArg = arg('couples');
  const couples =
    typeof couplesArg === 'string' && couplesArg.trim()
      ? couplesArg.split(',').map((value) => value.trim()).filter(Boolean)
      : undefined;
  const security = arg('security', false) === true;
  const focusArg = arg('focus', 'product');
  const focus = focusArg === 'useless' ? 'useless' : 'product';
  const groupsArg = arg('groups');
  const groups =
    typeof groupsArg === 'string' && groupsArg.trim()
      ? groupsArg.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean)
      : undefined;
  const config = loadConfig();
  try {
    const result = await runPipeline({
      mode,
      config,
      rounds: Number.isFinite(rounds) ? rounds : mode === 'oasis' ? 3 : undefined,
      repeat: Number.isFinite(repeat) ? repeat : undefined,
      couples,
      groups,
      security,
      focus,
      onEvent: (event) => print({ phase: event.phase, at: event.at }),
    });
    print({
      ok: true,
      runId: result.runRecord.runId,
      live: result.runRecord.live,
      scenarios: result.scenarios.length,
      coverage: result.coverage.summary,
    });
  } catch (error) {
    if (error instanceof LiveBlockedError || error instanceof OasisBlockedError) {
      process.stderr.write(`Simulation blocked: ${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

function cmdExtract() {
  const paths = labPaths();
  const latest = loadLatestRun();
  let bundles = [];
  if (latest?.live) {
    const runDir = join(paths.runsDir, latest.runId);
    const files = latest.bundles
      .map((_bundle, index) => join(runDir, `bundle-${String(index + 1).padStart(3, '0')}.json`))
      .filter((file) => existsSync(file));
    bundles = files.map((file) => readJson(file));
  } else {
    bundles = [readJson(join(paths.fixturesDir, 'simulation-bundle.dryrun.json'))];
  }
  const personas = loadPersonas();
  const result = extractAndAnalyze(bundles, { personas });
  print({ ok: true, scenarios: result.scenarios.length, coverage: result.coverage.summary });
}

function cmdCoverage() {
  const paths = labPaths();
  const scenarios = loadScenarios();
  const indexPath = join(paths.scenariosDir, 'index.json');
  const index = existsSync(indexPath) ? readJson(indexPath) : { scenarios: [] };
  const probesById = Object.fromEntries(index.scenarios.map((entry) => [entry.id, entry.probes ?? []]));
  const coverage = analyzeCoverage(scenarios, { probesById });
  const updated = applyCoverage(scenarios, coverage);
  for (const scenario of updated) {
    writeJson(join(paths.scenariosDir, `${scenario.id}.json`), scenario);
  }
  writeJson(join(paths.reportsDir, 'coverage.json'), coverage);
  print({ ok: true, summary: coverage.summary });
}

function cmdExecute() {
  const label = arg('label', 'latest');
  const { results } = executeScenarios({ label });
  print({
    ok: true,
    label,
    commands: results.commands.map((command) => ({
      project: command.project,
      exitCode: command.exitCode,
      testPath: command.testPath,
    })),
    scenarios: results.scenarios.map((scenario) => ({ id: scenario.id, status: scenario.status })),
  });
  if (results.scenarios.some((scenario) => scenario.status === 'executed_fail')) {
    process.exitCode = 1;
  }
}

function cmdReport() {
  const { json } = buildReport();
  print({ ok: true, report: 'tools/mirofish-lab/reports/latest.md', summary: json });
}

function cmdBaseline() {
  const result = loadBaseline();
  print({ ok: true, scenarios: result.scenarios.length, coverage: result.coverage.summary });
}

async function cmdLlmBaseline() {
  try {
    const result = await runLlmBaseline();
    print({ ok: true, model: result.model, scenarios: result.count });
  } catch (error) {
    if (error instanceof LlmBaselineBlocked) {
      print({ ok: false, blocked: true, reason: error.message });
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

async function cmdDoctor() {
  const config = loadConfig();
  const probe = await preflight({ config });
  const oasisHome = resolveMirofishHome();
  const oasisRunner = join(oasisHome, 'backend', 'scripts', 'run_reddit_simulation.py');
  const oasisKey = modelKey();
  const oasisBase = process.env.LLM_BASE_URL ?? (openCodeKey() ? 'http://127.0.0.1:5051/v1' : null);
  const uv = spawnSync('uv', ['--version'], { encoding: 'utf8' });
  const proxy = spawnSync('curl', ['-fsS', 'http://127.0.0.1:5051/health'], {
    encoding: 'utf8',
    timeout: 3000,
  });
  print({
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    repoHead: gitHead(labPaths().repoRoot),
    dirty: gitIsDirty(labPaths().repoRoot),
    mirofishBaseUrl: config.mirofish.baseUrl,
    mirofishReachable: probe.ok,
    mirofishError: probe.ok ? null : probe.error,
    seedVersion: config.simulation.seedVersion,
    model: config.simulation.model,
    rounds: config.simulation.maxRounds,
    repeat: config.simulation.repeatCount,
    oasis: {
      home: oasisHome,
      runner: oasisRunner,
      checkout: existsSync(oasisRunner),
      uv: uv.status === 0 ? (uv.stdout ?? '').trim() : null,
      modelEndpointConfigured: Boolean(oasisKey && oasisBase),
      opencodeProxy: proxy.status === 0,
      ready: Boolean(
        existsSync(oasisRunner) &&
          uv.status === 0 &&
          oasisKey &&
          oasisBase &&
          !String(oasisBase).includes('opencode.ai') &&
          (proxy.status === 0 || !String(oasisBase).includes('127.0.0.1:5051'))
      ),
    },
  });
}

async function cmdAll() {
  cmdSeeds();
  await cmdRun();
  if (process.exitCode) return;
  cmdBaseline();
  if (process.exitCode) return;
  cmdCoverage();
  cmdExecute();
  if (process.exitCode) return;
  cmdReport();
}

function usage() {
  print(`Aoi MiroFish lab

Usage:
  node tools/mirofish-lab/src/cli.mjs <command> [options]

Commands:
  check                 Validate seeds, personas, fixtures, and scenarios
  seeds                 Regenerate curated seed documents from this checkout
  personas              Validate the synthetic persona population
  run                   Run MiroFish or local OASIS (auto|live|dry-run|oasis). Options: --mode, --rounds, --repeat, --couples, --groups, --security, --focus useless
  extract               Re-extract scenarios from the latest live run or the dry-run fixture
  coverage              Re-run the coverage analyzer and update scenario coverage
  execute               Execute mapped scenarios. Option: --label <name>
  report                Write reports/latest.md and reports/latest.json
  baseline              Generate the contract-only comparison set
  baseline-llm          Generate an LLM-only comparison set (needs LAB_LLM_API_KEY)
  doctor                Show environment and live-server reachability
  all                   seeds -> run -> baseline -> coverage -> execute -> report

Environment:
  MIROFISH_BASE_URL     Loopback MiroFish URL (default http://127.0.0.1:5001)
  MIROFISH_MODEL        Model name recorded in the run (server owns the key)
  MIROFISH_MAX_ROUNDS   Simulation rounds (1-40)
  MIROFISH_REPEAT       Repeat count (1-5)
`);
}

const command = process.argv[2] ?? 'help';

try {
  switch (command) {
    case 'check':
      cmdCheck();
      break;
    case 'seeds':
      cmdSeeds();
      break;
    case 'personas':
      cmdPersonas();
      break;
    case 'run':
      await cmdRun();
      break;
    case 'extract':
      cmdExtract();
      break;
    case 'coverage':
      cmdCoverage();
      break;
    case 'execute':
      cmdExecute();
      break;
    case 'report':
      cmdReport();
      break;
    case 'baseline':
      cmdBaseline();
      break;
    case 'baseline-llm':
      await cmdLlmBaseline();
      break;
    case 'doctor':
      await cmdDoctor();
      break;
    case 'all':
      await cmdAll();
      break;
    case 'help':
    case '--help':
    case '-h':
      usage();
      break;
    default:
      usage();
      process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
