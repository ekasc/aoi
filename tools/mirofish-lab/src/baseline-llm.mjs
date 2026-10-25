import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TEMPLATES } from './templates.mjs';
import { validateScenarioSet } from './validate.mjs';
import { labPaths } from './lib/paths.mjs';
import { readJson, writeJson } from './lib/io.mjs';
import { seedPaths } from './seed-builder.mjs';

export class LlmBaselineBlocked extends Error {
  constructor(message) {
    super(message);
    this.name = 'LlmBaselineBlocked';
  }
}

function env(name) {
  return process.env[name]?.trim() || null;
}

/**
 * Optional contract-only LLM baseline.
 *
 * This is deliberately separate from MiroFish: it asks a model to generate
 * scenarios directly from the curated seed documents, with no graph, no
 * agents, and no simulation. It is the comparison arm for deciding whether
 * MiroFish adds anything.
 *
 * Credentials are read from the environment only and never printed or
 * written. Missing credentials are a blocked result, not a fixture.
 */
export async function runLlmBaseline({ count = 18 } = {}) {
  const apiKey = env('LAB_LLM_API_KEY') ?? env('LLM_API_KEY');
  const baseUrl = env('LAB_LLM_BASE_URL') ?? env('LLM_BASE_URL') ?? 'https://opencode.ai/inference/go/openai/v1';
  const model = env('LAB_LLM_MODEL') ?? env('LLM_MODEL_NAME') ?? 'deepseek-v4.1-flash';
  if (!apiKey) {
    throw new LlmBaselineBlocked(
      'LLM baseline is blocked: no LAB_LLM_API_KEY or LLM_API_KEY is set. No baseline was generated.'
    );
  }

  const paths = labPaths();
  const personas = readJson(join(paths.personasDir, 'personas.v1.json'));
  const seeds = seedPaths()
    .map((seed) => `\n\n=== ${seed.file} ===\n${readFileSync(seed.path, 'utf8')}`)
    .join('')
    .slice(0, 60000);

  const allowedActions = [...new Set(TEMPLATES.flatMap((template) => template.actions.map((action) => action.op)))];
  const prompt = [
    'You are generating test scenarios for Aoi, a private two-person relationship app.',
    'Use only the seed documents below. Do not invent product behavior that the documents do not support.',
    'Return JSON only: an object with a "scenarios" array.',
    `Create at least ${count} distinct scenarios, at least two per experiment group A-F.`,
    'Each scenario must have: id (temporary string), title, experiment (A-F), preconditions (array), actions (array of {"op": string}), expected_behavior (array), candidate_failure_modes (array), relevant_source_files (array of paths that appear in the seeds), confidence "hypothesis".',
    `Allowed actions: ${allowedActions.join(', ')}.`,
    'Do not include secrets, real personal data, URLs, recovery phrases, or instructions to run code.',
    'A scenario is a hypothesis, never a claim that a defect exists.',
    seeds,
  ].join('\n');

  let isOpenCode = false;
  try {
    isOpenCode = new URL(baseUrl).hostname.endsWith('opencode.ai');
  } catch {
    isOpenCode = false;
  }
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(isOpenCode
        ? {
            'x-opencode-session': randomUUID(),
            'User-Agent': 'aoi-mirofish-lab/1.0',
          }
        : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You produce strict JSON test scenarios. You do not claim that a simulation ran.' },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) {
    throw new Error(`LLM baseline request failed with status ${response.status}.`);
  }
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('LLM baseline returned no message content.');
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('LLM baseline returned invalid JSON.');
  }
  const proposals = Array.isArray(parsed) ? parsed : parsed.scenarios;
  if (!Array.isArray(proposals)) throw new Error('LLM baseline returned no scenarios array.');

  const personaPairs = personas.couples.map((couple) => couple.members);
  const scenarios = proposals.slice(0, Math.max(count, 12)).map((proposal, index) => {
    const template =
      TEMPLATES.find((entry) => entry.experiment === proposal.experiment) ?? TEMPLATES[0];
    const pair = personaPairs[index % personaPairs.length];
    const files = (proposal.relevant_source_files ?? []).filter((file) =>
      typeof file === 'string' && /^(app|components|features|packages|docs|tests|e2e)\//.test(file)
    );
    return {
      schemaVersion: 'aoi-scenario/1',
      id: `AOI-SIM-${String(index + 1).padStart(3, '0')}`,
      title: String(proposal.title ?? `LLM baseline scenario ${index + 1}`).slice(0, 160),
      experiment: ['A', 'B', 'C', 'D', 'E', 'F'].includes(proposal.experiment)
        ? proposal.experiment
        : template.experiment,
      source: {
        aoi_commit: readJson(join(paths.seedsDir, 'manifest.json')).aoiCommit,
        mirofish_commit: readJson(join(paths.seedsDir, 'manifest.json')).mirofishCommit,
        simulation_id: 'llm-baseline-contract-only',
        observation_ids: ['obs-001'],
        provenance: 'contract_baseline',
        seed_version: 'seeds-v1',
      },
      actors: pair,
      preconditions: Array.isArray(proposal.preconditions) && proposal.preconditions.length
        ? proposal.preconditions.map(String).slice(0, 12)
        : template.preconditions,
      actions: Array.isArray(proposal.actions) && proposal.actions.length
        ? proposal.actions.slice(0, 12).map((action) => ({ op: String(action.op ?? action) }))
        : template.actions,
      expected_behavior: Array.isArray(proposal.expected_behavior) && proposal.expected_behavior.length
        ? proposal.expected_behavior.map(String).slice(0, 12)
        : template.expected,
      candidate_failure_modes:
        Array.isArray(proposal.candidate_failure_modes) && proposal.candidate_failure_modes.length
          ? proposal.candidate_failure_modes.map(String).slice(0, 12)
          : template.failures,
      relevant_source_files: files.length ? files.slice(0, 20) : template.sourceFiles,
      existing_test_coverage: [],
      confidence: 'hypothesis',
      execution_target: 'manual',
      status: 'proposed',
      claims: {
        observed_code_behavior: ['Generated from the curated seed documents without a simulation.'],
        documented_requirement: template.expected,
        hypothetical_user_behavior: ['The LLM proposed this scenario from the contract text; no user said it.'],
        potential_defect: template.failures.map((failure) => `Hypothesis, not reproduced: ${failure}`),
        reproduced_defect: [],
      },
      coverage: { level: 'unanalyzed', evidence: [], notes: '' },
      safety: {
        synthetic_only: true,
        contains_secrets: false,
        production_data: false,
        arbitrary_code: false,
      },
    };
  });

  const validation = validateScenarioSet(scenarios, {
    repoRoot: paths.repoRoot,
    knownPersonas: new Map(personas.personas.map((person) => [person.id, person])),
    minimum: 12,
    requireAllGroups: true,
  });
  if (!validation.ok) {
    throw new Error(`LLM baseline failed validation:\n${validation.errors.join('\n')}`);
  }
  writeJson(join(paths.reportsDir, 'baseline-llm.json'), scenarios);
  return { scenarios, model, count: scenarios.length };
}
