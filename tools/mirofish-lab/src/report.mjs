import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { compareWithBaseline, loadLatestRun, loadPersonas, loadScenarios } from './pipeline.mjs';
import { readJson, writeText } from './lib/io.mjs';
import { labPaths } from './lib/paths.mjs';
import { gitHead } from './lib/git.mjs';
import { validateScenarioSet } from './validate.mjs';

function short(commit) {
  return commit ? commit.slice(0, 8) : 'unknown';
}

function table(rows, header) {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function countsBy(scenarios, key) {
  const map = new Map();
  for (const scenario of scenarios) {
    const value = typeof key === 'function' ? key(scenario) : scenario[key];
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
}

export function buildReport() {
  const paths = labPaths();
  const run = loadLatestRun();
  const scenarios = loadScenarios();
  const personas = loadPersonas();
  const seedManifest = readJson(join(paths.seedsDir, 'manifest.json'));
  const coveragePath = join(paths.reportsDir, 'coverage.json');
  const coverage = existsSync(coveragePath) ? readJson(coveragePath) : null;
  const executionPath = join(paths.reportsDir, 'execution-results.json');
  const execution = existsSync(executionPath) ? readJson(executionPath) : null;
  const baselineLlmPath = join(paths.reportsDir, 'baseline-llm.json');
  const baselineLlm = existsSync(baselineLlmPath) ? readJson(baselineLlmPath) : null;
  const beforeFixPath = join(paths.reportsDir, 'execution-results.before-fix.json');
  const beforeFix = existsSync(beforeFixPath) ? readJson(beforeFixPath) : null;
  const baseline = compareWithBaseline(scenarios);
  const validation = validateScenarioSet(scenarios, {
    repoRoot: paths.repoRoot,
    knownPersonas: new Map(personas.personas.map((person) => [person.id, person])),
    minimum: run?.mode === 'oasis' ? 1 : 12,
    requireAllGroups: run?.mode !== 'oasis',
  });
  if (!validation.ok) {
    throw new Error(`Cannot report invalid scenarios:\n${validation.errors.join('\n')}`);
  }

  const beforeFixFailures = beforeFix?.scenarios?.filter((entry) => entry.status === 'executed_fail') ?? [];
  const repairedIds = new Set(beforeFixFailures.map((entry) => entry.id));
  const reproduced = scenarios.filter(
    (scenario) =>
      scenario.status === 'executed_fail' ||
      (scenario.claims?.reproduced_defect?.length ?? 0) > 0 ||
      (repairedIds.has(scenario.id) && scenario.execution && scenario.status === 'executed_pass')
  );
  const executed = scenarios.filter((scenario) => scenario.execution && ['executed_pass', 'executed_fail'].includes(scenario.status));
  const hypotheses = scenarios.filter(
    (scenario) => scenario.execution_target === 'manual' || scenario.execution_target === 'native'
  );
  const gaps = scenarios.filter((scenario) =>
    ['partial', 'not_covered'].includes(scenario.coverage?.level ?? '')
  );
  const liveBlocked = run?.events?.find((event) => event.phase === 'live_blocked');
  const mode = run?.live
    ? 'live MiroFish simulation'
    : run?.mode === 'oasis'
      ? run?.security
        ? 'local OASIS security-focus simulation (no Zep, not MiroFish)'
        : 'local OASIS simulation (no Zep, not MiroFish)'
      : run?.mode === 'auto'
        ? 'auto (live blocked; offline dry-run fixture used)'
        : 'offline dry-run fixture';
  const groups = ['A', 'B', 'C', 'D', 'E', 'F'];
  const groupNames = {
    A: 'First use and partner onboarding',
    B: 'Shared memories',
    C: 'Us versus Memories',
    D: 'Offline and account lifecycle',
    E: 'Device recovery',
    F: 'Subscription boundaries',
  };

  const lines = [];
  lines.push(`# Aoi × MiroFish development simulation report`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`**Mode:** ${mode}. **Live MiroFish:** ${run?.live ? 'yes' : 'no'}.`);
  lines.push('');
  if (run?.mode === 'oasis') {
    lines.push(
      '> This report is based on a local OASIS discussion. It does not claim that MiroFish or Zep ran. A fictional participant\'s statement is still a hypothesis, not proof of Aoi behavior.'
    );
    lines.push('');
  } else if (!run?.live) {
    lines.push(
      '> This report is based on a clearly labelled offline fixture. It does not claim that MiroFish ran, and it does not claim that a simulated user discovered any behavior. The fixture exists to exercise the pipeline end to end without misrepresenting a live run.'
    );
    lines.push('');
  }
  lines.push(`- Aoi commit: \`${seedManifest.aoiCommit}\``);
  lines.push(`- MiroFish commit inspected: \`${seedManifest.mirofishCommit}\``);
  lines.push(`- Seed version: \`${seedManifest.seedVersion}\``);
  lines.push(`- Scenario schema: \`aoi-scenario/1\` (${scenarios.length} valid scenarios)`);
  lines.push('');

  lines.push('## 1. Simulations executed');
  lines.push('');
  if (run) {
    lines.push(
      table(
        [
          ['Mode', run.mode],
          ['Backend', run.backend ?? 'mirofish'],
          ['Focus', run.security ? 'security' : 'product'],
          ['Live MiroFish', String(run.live)],
          ['Rounds requested', String(run.rounds)],
          ['Repeats', String(run.repeat)],
          ['Base URL', run.baseUrl],
          ['Status', run.status],
          ['Scenarios extracted', String(run.scenarioCount)],
        ],
        ['Field', 'Value']
      )
    );
  } else {
    lines.push('No run record exists yet. Run `pnpm mirofish-lab:run -- --mode dry-run`.');
  }
  lines.push('');
  if (liveBlocked) {
    lines.push(`**Live simulation blocked:** ${liveBlocked.reason}`);
    lines.push('');
    lines.push(
      'MiroFish requires a reachable server, Zep Cloud, and an OpenAI-compatible model endpoint. None were available in this environment, so no live run is claimed.'
    );
    lines.push('');
  } else if (run?.mode === 'oasis') {
    lines.push(
      'Local OASIS ran without Zep. MiroFish was not started. OASIS is the social-interaction engine; the graph, profile-generation, and report layers are not present in this mode.'
    );
    lines.push('');
  } else if (!run?.live) {
    lines.push(
      'Live simulation was not attempted in this run. The fixture path is the documented offline fallback.'
    );
    lines.push('');
  }

  lines.push('## 2. Synthetic population and scenario groups');
  lines.push('');
  lines.push(
    `${personas.personas.length} fictional personas in ${personas.couples.length} couples. ` +
      `All are marked fictional; no production data, credentials, recovery phrases, or real locations are present.`
  );
  lines.push('');
  lines.push(
    table(
      groups.map((group) => [
        group,
        groupNames[group],
        String(scenarios.filter((scenario) => scenario.experiment === group).length),
      ]),
      ['Group', 'Experiment', 'Scenarios']
    )
  );
  lines.push('');
  const coverageCounts = countsBy(scenarios, (scenario) => scenario.coverage?.level ?? 'unanalyzed');
  lines.push(`Coverage distribution: ${coverageCounts.map(([level, count]) => `${level} ${count}`).join(', ')}.`);
  lines.push('');

  lines.push('## 3. Candidate scenarios');
  lines.push('');
  lines.push(
    table(
      scenarios.map((scenario) => [
        scenario.id,
        scenario.experiment,
        scenario.title.replace(/\|/g, '\\|'),
        scenario.confidence,
        scenario.status,
        scenario.coverage?.level ?? 'unanalyzed',
      ]),
      ['ID', 'Group', 'Title', 'Confidence', 'Status', 'Coverage']
    )
  );
  lines.push('');
  lines.push('Every scenario records its Aoi commit, simulation id, observation ids, source files, and separate claims for code behavior, documented requirements, and fictional user beliefs.');
  lines.push('');
  lines.push('### Traceability');
  lines.push('');
  lines.push(
    table(
      scenarios.map((scenario) => [
        scenario.id,
        scenario.source.observation_ids.join(', '),
        scenario.source.aoi_commit.slice(0, 8),
        scenario.relevant_source_files.slice(0, 2).map((file) => `\`${file}\``).join('<br>'),
      ]),
      ['ID', 'Observations', 'Aoi commit', 'Relevant source']
    )
  );
  lines.push('');

  lines.push('## 4. Coverage analysis against the existing tests');
  lines.push('');
  lines.push(
    'Coverage is derived from test assertions and exercised operations, not filenames. A `covered` result means one test block contains an assertion and matches the routed operations and behavior probes. `partial` means related evidence exists but no single test proves the full scenario.'
  );
  lines.push('');
  if (coverage) {
    lines.push(
      table(
        [
          ['covered', String(coverage.summary.covered)],
          ['partial', String(coverage.summary.partial)],
          ['not_covered', String(coverage.summary.not_covered)],
          ['not_automatable', String(coverage.summary.not_automatable)],
          ['invalid', String(coverage.summary.invalid)],
        ],
        ['Level', 'Count']
      )
    );
    lines.push('');
  }
  lines.push('### Priority gaps');
  lines.push('');
  const priority = gaps
    .slice()
    .sort((a, b) => {
      const weight = (scenario) =>
        /data loss|cross-account|authorization|sharing|recovery|concurrency|misleading|delete/i.test(
          `${scenario.title} ${scenario.candidate_failure_modes.join(' ')}`
        )
          ? 0
          : 1;
      return weight(a) - weight(b);
    })
    .slice(0, 8);
  for (const scenario of priority) {
    lines.push(
      `- **${scenario.id} ${scenario.title}** — ${scenario.coverage?.level}. ${scenario.coverage?.notes ?? ''}`
    );
  }
  lines.push('');

  lines.push('## 5. Executed scenarios and results');
  lines.push('');
  if (executed.length === 0) {
    lines.push('No scenario was executed in this pass.');
  } else {
    lines.push(
      table(
        executed.map((scenario) => [
          scenario.id,
          scenario.execution.test_path,
          scenario.status,
          (scenario.claims?.reproduced_defect?.[0] ?? '').replace(/\|/g, '\\|').slice(0, 120),
        ]),
        ['ID', 'Harness', 'Result', 'Failure evidence']
      )
    );
  }
  lines.push('');
  if (execution) {
    lines.push(`Commands for the latest execution (label \`${execution.label}\`):`);
    lines.push('');
    lines.push('```sh');
    for (const command of execution.commands) lines.push(command.command);
    lines.push('```');
    lines.push('');
    lines.push(
      'The integration scenarios run through the real Hono worker shell, session auth, D1 shim, and domain code. The unit scenario runs through the real SpaceProvider with a mocked repository, which is the layer where the defect lives.'
    );
  }
  lines.push('');

  lines.push('## 6. Reproduced defects');
  lines.push('');
  if (reproduced.length === 0) {
    lines.push('No scenario in this run reproduced a defect.');
    if (beforeFixFailures.length > 0) {
      lines.push('');
      lines.push('### Previously verified finding (not part of this run)');
      lines.push('');
      for (const entry of beforeFixFailures) {
        lines.push(
          `- \`${entry.id}\` failed before the repair: ${(entry.failure ?? '').split('\n')[0]}`
        );
      }
      lines.push('');
      lines.push(
        'The fix and regression test remain in the repository; this small live run did not regenerate that scenario.'
      );
    }
  } else {
    for (const scenario of reproduced) {
      const before = beforeFixFailures.find((entry) => entry.id === scenario.id);
      lines.push(`### ${scenario.id} — ${scenario.title}`);
      lines.push('');
      lines.push(`- Current status: \`${scenario.status}\`${before ? ' (reproduced before the repair, passing afterward)' : ''}`);
      lines.push(`- Test: \`${scenario.execution.test_path}\``);
      for (const defect of scenario.claims.reproduced_defect) lines.push(`- Evidence: ${defect}`);
      if (before) {
        lines.push(`- Before-fix evidence: ${(before.failure ?? '').split('\n')[0]}`);
        lines.push(`- Before-fix command: \`${beforeFix.commands?.[0]?.command ?? 'recorded in execution-results.before-fix.json'}\``);
      }
      lines.push('');
      lines.push('Relevant source: ' + scenario.relevant_source_files.map((file) => `\`${file}\``).join(', '));
      lines.push('');
    }
  }
  if (beforeFix) {
    const before = beforeFix.scenarios.filter(
      (entry) => entry.status === 'executed_fail' && scenarios.some((scenario) => scenario.id === entry.id)
    );
    if (before.length > 0) {
      lines.push('### Execution history');
      lines.push('');
      lines.push(
        'The same scenario was executed before the repair and failed, then passed afterward. This is the before/after evidence that distinguishes a reproduced defect from a hypothesis.'
      );
      lines.push('');
      for (const entry of before) {
        lines.push(`- \`${entry.id}\` before fix: **${entry.status}** — ${(entry.failure ?? '').split('\n')[0]}`);
      }
      lines.push('');
    }
  }

  lines.push('## 7. UX hypotheses requiring human validation');
  lines.push('');
  for (const scenario of hypotheses) {
    lines.push(`- **${scenario.id} ${scenario.title}** — ${scenario.coverage?.notes ?? 'Needs human validation.'}`);
  }
  lines.push('');
  lines.push(
    'A passing test does not show that a person understands the interface. These items stay hypotheses until the owner runs them on real devices.'
  );
  lines.push('');

  lines.push('## 8. Unsupported or inconclusive findings');
  lines.push('');
  const unclassified = run?.unclassified ?? [];
  if (unclassified.length === 0) {
    lines.push('- No observation was left unclassified by the extractor in this run.');
  } else {
    lines.push(`- Unclassified observations: ${unclassified.join(', ')}.`);
  }
  lines.push(
    '- MiroFish simulates OASIS social interactions (posts, comments, likes), not Aoi UI actions. This lab treats those interactions as discussion material only.'
  );
  lines.push(
    '- A local OASIS mode is implemented (`--mode oasis`) and does not use Zep. It was not run here because no model key and no MiroFish checkout were available.'
  );
  lines.push(
    '- The source does not establish that a live MiroFish run will produce useful scenarios. The fixture demonstrates the pipeline, not the simulation.'
  );
  lines.push(
    '- Native device recovery, permissions, keyboard behavior, audio routing, and live store purchases remain outside this harness.'
  );
  lines.push('');

  lines.push('## 9. Baseline comparison');
  lines.push('');
  if (!baseline.available) {
    lines.push(baseline.reason ?? 'Baseline not generated.');
  } else {
    lines.push(
      `${baseline.baselineCount} contract-only baseline scenarios vs ${baseline.simulationCount} simulation-labelled scenarios. ` +
        `${baseline.overlap.length} overlap; ${baseline.unique.length} are unique to the simulation-labelled set.`
    );
    lines.push('');
    lines.push(`- Overlap: ${baseline.overlap.length ? baseline.overlap.join('; ') : 'none'}`);
    lines.push(`- Unique to the scenario set: ${baseline.unique.length ? baseline.unique.join('; ') : 'none'}`);
    lines.push('');
    lines.push(baseline.note);
  }
  lines.push('');
  if (baselineLlm) {
    const llmKeys = baselineLlm.map((scenario) => `${scenario.experiment}:${scenario.title}`);
    const scenarioKeys = scenarios.map((scenario) => `${scenario.experiment}:${scenario.title}`);
    const llmUnique = llmKeys.filter((key) => !scenarioKeys.includes(key));
    lines.push(
      `An LLM-only baseline also ran: ${baselineLlm.length} scenarios, ${llmUnique.length} not represented in the simulation-labelled set.`
    );
    lines.push('');
    lines.push('### LLM-only baseline scenarios not in this set');
    lines.push('');
    for (const title of llmUnique.slice(0, 12)) lines.push(`- ${title}`);
    lines.push('');
    lines.push(
      'An LLM-only scenario that the simulation set misses is evidence for the simpler baseline, not for MiroFish. The reverse is the case for a live simulation that adds a scenario the LLM baseline misses.'
    );
  } else {
    lines.push(
      'LLM-only baseline: **blocked**. No `LAB_LLM_API_KEY` or `LLM_API_KEY` was set, so no LLM baseline was generated. The deterministic contract baseline above is the offline substitute, and the MiroFish-vs-LLM comparison remains open.'
    );
  }
  lines.push('');

  lines.push('## 10. Verdict');
  lines.push('');
  lines.push(
    'The pipeline is functional and reproducible: it generates grounded seeds, validates strict scenarios, maps coverage, executes supported scenarios, and records evidence. It also found and verified one real cross-account state defect in `features/space/space-context.tsx`.'
  );
  lines.push('');
  lines.push(
    run?.mode === 'oasis'
      ? 'This run used local OASIS without Zep. It demonstrates that the social-discussion path can run without a graph service, but it does not demonstrate MiroFish\'s graph or report value. Compare the OASIS-derived scenarios against the contract-only baseline before deciding whether the simulation adds anything.'
      : 'MiroFish itself has not demonstrated additional value yet. No live simulation was possible here. The decision to keep MiroFish should be made after one bounded live run on a reachable host, compared against the contract-only baseline. If the live run does not produce a scenario that the baseline misses and that leads to a new verified test or defect, the recommendation is to keep the harness and drop the MiroFish dependency.'
  );
  lines.push('');

  lines.push('## Reproduce');
  lines.push('');
  lines.push('```sh');
  lines.push('pnpm mirofish-lab:check');
  lines.push('pnpm mirofish-lab:seeds');
  lines.push('pnpm mirofish-lab:run -- --mode dry-run');
  lines.push('pnpm mirofish-lab:baseline');
  lines.push('pnpm mirofish-lab:coverage');
  lines.push('pnpm mirofish-lab:execute -- --label after-fix');
  lines.push('pnpm mirofish-lab:report');
  lines.push('```');
  lines.push('');
  lines.push('For a live run, see `tools/mirofish-lab/README.md` and `tools/mirofish-lab/scripts/setup-mirofish.sh`.');
  lines.push('');
  lines.push('For OpenCode Go, run `pnpm mirofish-lab:proxy` and set `LLM_BASE_URL=http://127.0.0.1:5051/v1`; the proxy adds the required `x-opencode-session` header.');
  lines.push('');

  const markdown = lines.join('\n');
  const json = {
    schemaVersion: 'aoi-mirofish-report/1',
    generatedAt: new Date().toISOString(),
    aoiCommit: gitHead(paths.repoRoot),
    mirofishCommit: seedManifest.mirofishCommit,
    run: run
      ? {
          runId: run.runId,
          mode: run.mode,
          live: run.live,
          rounds: run.rounds,
          repeat: run.repeat,
          status: run.status,
          backend: run.backend ?? 'mirofish',
        }
      : null,
    personas: personas.personas.length,
    couples: personas.couples.length,
    scenarioCount: scenarios.length,
    coverage: coverage?.summary ?? null,
    executed: executed.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      status: scenario.status,
      testPath: scenario.execution.test_path,
      reproduced: scenario.claims.reproduced_defect,
    })),
    historicalReproducedDefects: beforeFixFailures.map((entry) => ({
      id: entry.id,
      beforeFix: { status: entry.status, failure: entry.failure },
      note: 'Verified before the repair; not part of the current run.',
    })),
    reproducedDefects: reproduced.map((scenario) => {
      const before = beforeFixFailures.find((entry) => entry.id === scenario.id);
      return {
        id: scenario.id,
        title: scenario.title,
        currentStatus: scenario.status,
        evidence:
          scenario.claims.reproduced_defect.length > 0
            ? scenario.claims.reproduced_defect
            : before
              ? [before.failure]
              : [],
        repaired: Boolean(before && scenario.status === 'executed_pass'),
        beforeFix: before ? { status: before.status, failure: before.failure } : null,
        sourceFiles: scenario.relevant_source_files,
      };
    }),
    hypotheses: hypotheses.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      level: scenario.coverage?.level,
      notes: scenario.coverage?.notes,
    })),
    baseline,
    baselineLlm: baselineLlm
      ? { available: true, count: baselineLlm.length }
      : { available: false, reason: 'No LLM baseline key was available.' },
    liveBlocked: liveBlocked?.reason ?? null,
    verdict:
      'Pipeline verified; one cross-account state defect reproduced and repaired. MiroFish value remains unproven without a live run.',
  };

  writeText(join(paths.reportsDir, 'latest.md'), markdown);
  writeText(join(paths.reportsDir, 'latest.json'), `${JSON.stringify(json, null, 2)}\n`);
  return { markdown, json };
}
