import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeCoverage, buildTestIndex } from '../src/coverage.mjs';
import { extractScenarios } from '../src/extract.mjs';
import { loadPersonas } from '../src/pipeline.mjs';
import { labPaths } from '../src/lib/paths.mjs';
import { readJson } from '../src/lib/io.mjs';

test('coverage evidence is line-addressable and based on assertions, not filenames', () => {
  const index = buildTestIndex();
  assert.ok(index.blocks.length > 1000);
  assert.ok(index.blocks.every((block) => typeof block.file === 'string'));
  assert.ok(index.blocks.some((block) => block.hasAssertion));
});

function fixtureCoverage() {
  const personas = loadPersonas();
  const bundle = readJson(`${labPaths().fixturesDir}/simulation-bundle.dryrun.json`);
  const result = extractScenarios(bundle, { personas, minimum: 1, requireAllGroups: false });
  return analyzeCoverage(result.scenarios, { internal: result.internal });
}

test('a unit scenario is covered by the regression test after the repair', () => {
  const coverage = fixtureCoverage();
  const scenario = coverage.scenarios.find((entry) => entry.id === 'AOI-SIM-011');
  assert.ok(scenario);
  assert.equal(scenario.level, 'covered');
  assert.ok(
    scenario.evidence.some((evidence) =>
      evidence.includes('mirofish-stale-space-mutation.test.tsx')
    )
  );
});

test('a comprehension-only scenario is not reported as automatically covered', () => {
  const coverage = fixtureCoverage();
  const scenario = coverage.scenarios.find((entry) => entry.id === 'AOI-SIM-007');
  assert.ok(scenario);
  assert.ok(['not_automatable', 'partial', 'not_covered'].includes(scenario.level));
});
