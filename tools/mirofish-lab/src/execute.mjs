import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { labPaths } from './lib/paths.mjs';
import { readJson, writeJson } from './lib/io.mjs';
import { loadScenarios } from './pipeline.mjs';

function runVitest({ project, testPath, outputFile, repoRoot }) {
  const args = [
    'exec',
    'vitest',
    'run',
    '--project',
    project,
    '--maxWorkers',
    '1',
    '--reporter=json',
    `--outputFile=${outputFile}`,
    testPath,
  ];
  const result = spawnSync('pnpm', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=512' },
    timeout: 20 * 60 * 1000,
  });
  return {
    command: `pnpm ${args.join(' ')}`,
    status: result.status,
    stdout: (result.stdout ?? '').slice(-12000),
    stderr: (result.stderr ?? '').slice(-12000),
  };
}

function parseReport(path) {
  if (!existsSync(path)) return [];
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const assertions = [];
  for (const file of report.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      assertions.push({
        title: assertion.fullName ?? assertion.title,
        status: assertion.status,
        failureMessages: assertion.failureMessages ?? [],
        durationMs: assertion.duration ?? null,
        file: file.name,
      });
    }
  }
  return assertions;
}

export function executeScenarios({ label = 'latest' } = {}) {
  const paths = labPaths();
  const scenarios = loadScenarios();
  const runnable = scenarios.filter((scenario) => scenario.execution);
  const representative = [];
  for (const scenario of runnable) {
    if (!representative.some((entry) => entry.title === scenario.title)) representative.push(scenario);
  }
  if (runnable.length === 0) {
    throw new Error('No scenarios have an execution mapping. Run extraction first.');
  }

  const artifactsDir = join(paths.reportsDir, 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  const targets = [
    {
      project: 'integration',
      testPath: 'tests/integration/mirofish-scenario-execution.test.ts',
      scenarios: representative.filter((scenario) => scenario.execution.target === 'integration'),
    },
    {
      project: 'unit-app',
      testPath: 'tests/unit/space/mirofish-stale-space-mutation.test.tsx',
      scenarios: representative.filter((scenario) => scenario.execution.target === 'unit'),
    },
  ].filter((target) => target.scenarios.length > 0);

  const results = {
    schemaVersion: 'aoi-execution-results/1',
    label,
    generatedAt: new Date().toISOString(),
    aoiCommit: readJson(join(paths.seedsDir, 'manifest.json')).aoiCommit,
    commands: [],
    scenarios: [],
  };

  for (const target of targets) {
    const outputFile = join('tools', 'mirofish-lab', 'reports', 'artifacts', `vitest-${target.project}-${label}.json`);
    const absoluteOutputFile = join(paths.repoRoot, outputFile);
    rmSync(absoluteOutputFile, { force: true });
    const execution = runVitest({
      project: target.project,
      testPath: target.testPath,
      outputFile,
      repoRoot: paths.repoRoot,
    });
    results.commands.push({
      project: target.project,
      testPath: target.testPath,
      command: execution.command,
      exitCode: execution.status,
      stdoutTail: execution.stdout,
      stderrTail: execution.stderr,
    });
    const assertions = parseReport(absoluteOutputFile);
    for (const scenario of target.scenarios) {
      const matching = assertions.filter((assertion) => assertion.title.includes(scenario.id));
      const failed = matching.filter((assertion) => assertion.status === 'failed');
      const passed = matching.filter((assertion) => assertion.status === 'passed');
      const status = failed.length > 0 ? 'executed_fail' : passed.length > 0 ? 'executed_pass' : 'not_run';
      const failure = failed.flatMap((assertion) => assertion.failureMessages).join('\n').trim();
      results.scenarios.push({
        id: scenario.id,
        target: target.project,
        testPath: scenario.execution.test_path,
        status,
        durationMs: matching.reduce((sum, assertion) => sum + (assertion.durationMs ?? 0), 0),
        failure: failure ? failure.slice(0, 4000) : null,
        testTitles: matching.map((assertion) => assertion.title),
      });
    }
  }

  const representativeIds = new Set(representative.map((scenario) => scenario.id));
  for (const scenario of scenarios) {
    if (scenario.execution && !representativeIds.has(scenario.id)) {
      if (['executed_pass', 'executed_fail'].includes(scenario.status)) {
        const cleaned = {
          ...scenario,
          status: 'mapped',
          confidence: 'hypothesis',
          claims: { ...scenario.claims, reproduced_defect: [] },
          existing_test_coverage: (scenario.existing_test_coverage ?? []).filter(
            (entry) => !/\((integration|unit-app),/.test(entry)
          ),
        };
        cleaned.coverage = {
          ...cleaned.coverage,
          evidence: (cleaned.coverage?.evidence ?? []).filter(
            (entry) => !/\((integration|unit-app),/.test(entry)
          ),
        };
        writeJson(join(paths.scenariosDir, `${scenario.id}.json`), cleaned);
      }
      continue;
    }
    const result = results.scenarios.find((entry) => entry.id === scenario.id);
    if (!result) continue;
    const path = join(paths.scenariosDir, `${scenario.id}.json`);
    const updated = { ...scenario };
    const evidence = new Set(updated.existing_test_coverage ?? []);
    evidence.add(`${scenario.execution.test_path} (${result.target}, ${label}) — ${result.status}`);
    updated.existing_test_coverage = [...evidence];
    updated.coverage = {
      ...updated.coverage,
      evidence: [...new Set([...(updated.coverage?.evidence ?? []), ...updated.existing_test_coverage])],
    };
    if (result.status === 'executed_pass') {
      updated.status = 'executed_pass';
    } else if (result.status === 'executed_fail') {
      updated.status = 'executed_fail';
      updated.confidence = 'reproduced';
      const firstLine = (result.failure ?? 'Executed scenario failed without a captured assertion message.')
        .split('\n')
        .find((line) => line.trim().length > 0) ?? 'Executed scenario failed.';
      const defects = new Set(updated.claims.reproduced_defect ?? []);
      defects.add(`${scenario.title}: ${firstLine}`.slice(0, 500));
      updated.claims = { ...updated.claims, reproduced_defect: [...defects] };
    }
    writeJson(path, updated);
  }

  const serialized = `${JSON.stringify(results, null, 2)}\n`;
  writeJson(join(paths.reportsDir, 'execution-results.json'), results);
  if (label !== 'latest') {
    writeJson(join(paths.reportsDir, `execution-results.${label}.json`), results);
  }
  return { results, serialized };
}
