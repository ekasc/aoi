import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { extractScenarios } from '../src/extract.mjs';
import { loadPersonas } from '../src/pipeline.mjs';
import { labPaths } from '../src/lib/paths.mjs';
import { validateSimulationBundle } from '../src/validate.mjs';

const paths = labPaths();
const personas = loadPersonas();

test('dry-run extraction is deterministic and produces 19 distinct scenarios', () => {
  const bundle = JSON.parse(readFileSync(join(paths.fixturesDir, 'simulation-bundle.dryrun.json'), 'utf8'));
  const first = extractScenarios(bundle, { personas, minimum: 1, requireAllGroups: false });
  const second = extractScenarios(bundle, { personas, minimum: 1, requireAllGroups: false });
  assert.equal(first.scenarios.length, 19);
  assert.deepEqual(
    first.scenarios.map((scenario) => scenario.id),
    second.scenarios.map((scenario) => scenario.id)
  );
  assert.equal(new Set(first.scenarios.map((scenario) => scenario.title)).size, 19);
  assert.equal(first.unclassified.length, 0);
});

test('every extracted scenario is a hypothesis with separated claims and fixture provenance', () => {
  const bundle = JSON.parse(readFileSync(join(paths.fixturesDir, 'simulation-bundle.dryrun.json'), 'utf8'));
  const result = extractScenarios(bundle, { personas, minimum: 1, requireAllGroups: false });
  for (const scenario of result.scenarios) {
    assert.equal(scenario.source.provenance, 'offline_fixture');
    assert.equal(scenario.confidence, 'hypothesis');
    assert.ok(scenario.claims.observed_code_behavior.length > 0);
    assert.ok(scenario.claims.documented_requirement.length > 0);
    assert.ok(scenario.claims.hypothetical_user_behavior.length > 0);
    assert.ok(
      scenario.claims.potential_defect.every((claim) => claim.startsWith('Hypothesis, not reproduced:'))
    );
    assert.deepEqual(scenario.claims.reproduced_defect, []);
    assert.equal(scenario.safety.production_data, false);
  }
});

test('a fixture that claims to be live is rejected', () => {
  const bundle = JSON.parse(readFileSync(join(paths.fixturesDir, 'simulation-bundle.dryrun.json'), 'utf8'));
  bundle.live = true;
  const result = validateSimulationBundle(bundle, {
    knownPersonas: new Set(personas.personas.map((person) => person.id)),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('must not claim live=true')));
});

test('an observation with an unknown persona is rejected', () => {
  const bundle = JSON.parse(readFileSync(join(paths.fixturesDir, 'simulation-bundle.dryrun.json'), 'utf8'));
  bundle.observations[0].persona_id = 'p-not-a-person';
  const result = validateSimulationBundle(bundle, {
    knownPersonas: new Set(personas.personas.map((person) => person.id)),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('unknown persona')));
});
