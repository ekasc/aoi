import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig, requireLiveConfig } from './config.mjs';
import { analyzeCoverage, applyCoverage } from './coverage.mjs';
import { extractScenarios } from './extract.mjs';
import { buildSeeds } from './seed-builder.mjs';
import { LiveBlockedError, preflight, runLiveSimulation } from './simulation-runner.mjs';
import { runOasis } from './oasis.mjs';
import { validatePersonas, validateScenarioSet, validateSimulationBundle } from './validate.mjs';
import { listFiles, readJson, writeJson, writeText } from './lib/io.mjs';
import { gitHead } from './lib/git.mjs';
import { labPaths } from './lib/paths.mjs';

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function loadPersonas() {
  const paths = labPaths();
  const personas = readJson(join(paths.personasDir, 'personas.v1.json'));
  const validation = validatePersonas(personas);
  if (!validation.ok) {
    throw new Error(`Persona validation failed:\n${validation.errors.join('\n')}`);
  }
  return personas;
}

function loadBundle(path, personas) {
  const bundle = readJson(path);
  const validation = validateSimulationBundle(bundle, {
    knownPersonas: new Set(personas.personas.map((person) => person.id)),
  });
  if (!validation.ok) {
    throw new Error(`Bundle validation failed for ${path}:\n${validation.errors.join('\n')}`);
  }
  return bundle;
}

export function extractAndAnalyze(bundles, { personas, provenanceOverride, repoRoot = labPaths().repoRoot, write = true, minimum = 12, requireAllGroups = true } = {}) {
  const collected = [];
  const internal = [];
  const unclassified = [];
  let offset = 0;
  for (const bundle of bundles) {
    const result = extractScenarios(bundle, {
      personas,
      repoRoot,
      strict: true,
      provenanceOverride,
      minimum: 1,
      requireAllGroups: false,
    });
    unclassified.push(...result.unclassified);
    for (let index = 0; index < result.scenarios.length; index += 1) {
      const scenario = { ...result.scenarios[index] };
      const meta = { ...result.internal[index] };
      const newId = `AOI-SIM-${String(offset + index + 1).padStart(3, '0')}`;
      scenario.id = newId;
      meta.id = newId;
      collected.push(scenario);
      internal.push(meta);
    }
    offset += result.scenarios.length;
  }

  const validation = validateScenarioSet(collected, {
    repoRoot,
    knownPersonas: new Map(personas.personas.map((person) => [person.id, person])),
    minimum,
    requireAllGroups,
  });
  if (!validation.ok) {
    throw new Error(`Combined scenario validation failed:\n${validation.errors.join('\n')}`);
  }

  const coverage = analyzeCoverage(collected, { repoRoot, internal });
  const scenarios = applyCoverage(collected, coverage);

  const paths = labPaths();
  if (!write) {
    return { scenarios, coverage, internal, unclassified, validation };
  }
  for (const name of readdirSync(paths.scenariosDir)) {
    if (/^AOI-SIM-\d{3}\.json$/.test(name)) {
      unlinkSync(join(paths.scenariosDir, name));
    }
  }
  for (const scenario of scenarios) {
    writeJson(join(paths.scenariosDir, `${scenario.id}.json`), scenario);
  }
  writeJson(join(paths.scenariosDir, 'index.json'), {
    schemaVersion: 'aoi-scenario-index/1',
    generatedAt: new Date().toISOString(),
    scenarios: internal.map((meta) => ({
      id: meta.id,
      title: meta.template.title,
      experiment: meta.template.experiment,
      templateKey: meta._templateKey,
      probes: meta._coverageProbes,
      actors: [meta.actor.id, meta.partner?.id].filter(Boolean),
      observationIds: meta.observationIds,
    })),
  });
  writeJson(join(paths.reportsDir, 'coverage.json'), coverage);
  return { scenarios, coverage, internal, unclassified, validation };
}

export async function runPipeline({ mode = 'auto', rounds, repeat, couples, groups, security = false, focus = 'product', config: suppliedConfig, onEvent = () => {} } = {}) {
  const paths = labPaths();
  const config = suppliedConfig ?? loadConfig();
  const runId = `${mode === 'live' ? 'live' : mode === 'oasis' ? 'oasis' : 'dryrun'}-${timestamp()}`;
  const runDir = join(paths.runsDir, runId);
  const startedAt = new Date().toISOString();
  const aoiCommit = gitHead(paths.repoRoot);
  const seedResult = buildSeeds();
  const personas = loadPersonas();
  const selectedRounds = rounds ?? config.simulation.maxRounds;
  const selectedRepeat = repeat ?? (mode === 'oasis' ? 1 : config.simulation.repeatCount);
  const bundles = [];
  const runRecord = {
    schemaVersion: 'aoi-mirofish-run/1',
    runId,
    mode,
    live: false,
    startedAt,
    finishedAt: null,
    aoiCommit,
    mirofishCommit: seedResult.manifest.mirofishCommit,
    seedVersion: config.simulation.seedVersion,
    rounds: selectedRounds,
    repeat: selectedRepeat,
    baseUrl: mode === 'oasis' ? null : config.mirofish.baseUrl,
    model: config.simulation.model,
    status: 'running',
    error: null,
    bundles: [],
    events: [],
  };

  const emit = (event) => {
    runRecord.events.push(event);
    onEvent(event);
  };

  if (mode === 'oasis') {
    emit({ phase: 'oasis_start', at: new Date().toISOString() });
    const oasis = runOasis({
      config,
      personas,
      rounds: selectedRounds,
      coupleIds: couples,
      groups,
      security,
      focus,
      onEvent: emit,
    });
    bundles.push(...oasis.bundles);
    runRecord.live = false;
    runRecord.backend = 'oasis';
    runRecord.security = security;
    runRecord.focus = focus;
    runRecord.model = process.env.LLM_MODEL_NAME ?? runRecord.model;
    runRecord.oasis = {
      runId: oasis.runId,
      runDir: oasis.runDir,
      rawFiles: oasis.rawFiles,
      errors: oasis.errors,
    };
    for (const bundle of oasis.bundles) {
      runRecord.bundles.push({
        simulationId: bundle.provenance.simulation_id,
        coupleId: bundle.provenance.couple_id,
        backend: 'oasis',
      });
    }
  }

  if (mode !== 'dry-run' && mode !== 'oasis') {
    const liveErrors = requireLiveConfig(config);
    if (liveErrors.length > 0) {
      throw new LiveBlockedError(`Live configuration is invalid:\n${liveErrors.join('\n')}`);
    }
    emit({ phase: 'preflight', at: new Date().toISOString() });
    const probe = await preflight({ config });
    if (!probe.ok) {
      if (mode === 'live') {
        throw new LiveBlockedError(
          `Live MiroFish is unreachable at ${config.mirofish.baseUrl}: ${probe.error}. Start MiroFish on a reachable host and retry. No fixture was substituted.`
        );
      }
      emit({
        phase: 'live_blocked',
        at: new Date().toISOString(),
        reason: `MiroFish is unreachable at ${config.mirofish.baseUrl}: ${probe.error}`,
      });
    } else {
      for (let index = 0; index < selectedRepeat; index += 1) {
        emit({ phase: 'live_run_start', at: new Date().toISOString(), repeatIndex: index });
        const result = await runLiveSimulation({
          config,
          personas,
          rounds: selectedRounds,
          repeatIndex: index,
          onEvent: emit,
        });
        bundles.push(result.bundle);
        writeJson(join(runDir, `bundle-${String(index + 1).padStart(3, '0')}.json`), result.bundle);
        runRecord.bundles.push({
          simulationId: result.simulationId,
          projectId: result.projectId,
          graphId: result.graphId,
          repeatIndex: index,
        });
      }
      runRecord.live = true;
    }
  }

  if (bundles.length === 0 && mode !== 'oasis') {
    const fixture = loadBundle(join(paths.fixturesDir, 'simulation-bundle.dryrun.json'), personas);
    bundles.push(fixture);
    writeJson(join(runDir, 'bundle-001.json'), fixture);
    runRecord.bundles.push({ simulationId: fixture.provenance.simulation_id, fixture: true });
    emit({
      phase: 'dry_run_fixture',
      at: new Date().toISOString(),
      label: fixture.provenance.label,
    });
  }

  const analysis = extractAndAnalyze(bundles, {
    personas,
    minimum: mode === 'oasis' ? 1 : 12,
    requireAllGroups: mode !== 'oasis',
  });
  runRecord.finishedAt = new Date().toISOString();
  runRecord.status = 'complete';
  runRecord.scenarioCount = analysis.scenarios.length;
  runRecord.coverageSummary = analysis.coverage.summary;
  writeJson(join(runDir, 'run.json'), runRecord);
  writeJson(join(paths.runsDir, 'latest.json'), runRecord);
  return {
    runRecord,
    runDir,
    bundles,
    personas,
    ...analysis,
  };
}

export function loadLatestRun() {
  const paths = labPaths();
  const latestPath = join(paths.runsDir, 'latest.json');
  if (!existsSync(latestPath)) return null;
  return readJson(latestPath);
}

export function loadScenarios() {
  const paths = labPaths();
  return listFiles(paths.scenariosDir, (file) => /\/AOI-SIM-\d{3}\.json$/.test(file))
    .map((file) => readJson(file))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function loadBaseline() {
  const paths = labPaths();
  const personas = loadPersonas();
  const bundle = loadBundle(join(paths.fixturesDir, 'baseline-contract.dryrun.json'), personas);
  const result = extractAndAnalyze([bundle], {
    personas,
    provenanceOverride: 'contract_baseline',
    write: false,
    minimum: 1,
    requireAllGroups: false,
  });
  writeJson(join(paths.reportsDir, 'baseline-scenarios.json'), result.scenarios);
  return result;
}

export function compareWithBaseline(scenarios) {
  const paths = labPaths();
  const baselinePath = join(paths.reportsDir, 'baseline-scenarios.json');
  if (!existsSync(baselinePath)) {
    return { available: false, reason: 'Run the baseline command first.' };
  }
  const baseline = readJson(baselinePath);
  const index = readJson(join(paths.scenariosDir, 'index.json'));
  const baselineIndex = baseline.map((scenario) => `${scenario.experiment}:${scenario.title}`);
  const scenarioKeys = index.scenarios.map((entry) => `${entry.experiment}:${entry.title}`);
  const overlap = scenarioKeys.filter((key) => baselineIndex.includes(key));
  const unique = scenarioKeys.filter((key) => !baselineIndex.includes(key));
  return {
    available: true,
    baselineCount: baseline.length,
    simulationCount: scenarios.length,
    overlap,
    unique,
    note:
      'This comparison is structural. When the simulation bundle is a dry-run fixture, unique scenarios demonstrate pipeline breadth, not that MiroFish discovered them.',
  };
}

export function writeRunNote(runRecord, text) {
  const paths = labPaths();
  writeText(join(paths.runsDir, runRecord.runId, 'note.md'), text);
}
