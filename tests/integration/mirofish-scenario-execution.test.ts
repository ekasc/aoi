import { describe, expect, it } from 'vitest';

import {
  loadExecutableScenarios,
  runScenario,
} from './helpers/mirofish-scenario-executor';

/**
 * Executes MiroFish-lab scenarios through Aoi's real worker shell: Hono
 * routes, session auth, the D1 shim, and real domain code. Scenarios are
 * whitelisted JSON data; this file never evaluates generated code.
 */
const scenarios = loadExecutableScenarios('integration');

describe('MiroFish-lab executable scenarios', () => {
  it('loads at least one supported integration scenario', () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  for (const scenario of scenarios) {
    it(`${scenario.id} — ${scenario.title}`, async () => {
      await runScenario(scenario);
    });
  }
});
