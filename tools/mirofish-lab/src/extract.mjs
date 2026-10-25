import { TEMPLATES } from './templates.mjs';
import { validateScenarioSet } from './validate.mjs';
import { labPaths } from './lib/paths.mjs';

/**
 * Source-backed behavior notes, keyed by the files a scenario cites. These are
 * observations from reading the current checkout, not claims made by a
 * simulated participant. Keeping them separate is what stops a fictional
 * quote from becoming a factual assertion about Aoi.
 */
const CODE_FACTS = {
  'packages/api/src/domains/spaces.ts': [
    'Spaces enforce one active membership per user and one active partner per space at the storage layer.',
    'Joining redeems an invite once; an expired or already-redeemed code is rejected, and a historical partner slot is permanently bound.',
    'Leaving flips the caller\'s membership to left and keeps shared history for the remaining member.',
  ],
  'packages/api/src/domains/moments.ts': [
    'Memory create is idempotent per (space_id, client_id) while the row is live.',
    'Update and delete compare the observed updatedAt; a stale write returns 409 without side effects.',
    'Authorship and authorName are computed per viewer, not stored as a snapshot.',
  ],
  'components/space/partner-invitation.tsx': [
    'The invitation sheet regenerates an expired code before sharing.',
    'Opening the share sheet does not claim delivery or membership.',
  ],
  'features/space/space-context.tsx': [
    'Space hydration, foreground refresh, and mutation callbacks are scoped to the signed-in user id.',
  ],
  'features/session/session-context.tsx': [
    'Session restore republishes API tokens before remote reads.',
    'Sign out clears the stored session and token plumbing.',
  ],
  'packages/shared/src/plus.ts': [
    'Plus is a Space-level entitlement: one row is shared by both active members.',
    'The Free media ceiling is 250 MiB and the Plus ceiling is 5 GiB; future-letter allowance differs by plan.',
  ],
  'packages/api/src/domains/plus.ts': [
    'The backend entitlement row is authoritative; client local purchase state cannot grant features.',
    'Verified webhook deliveries are deduplicated and stale events cannot regress a newer state.',
  ],
  'features/album/protocol-recovery.ts': [
    'Recovery is an explicit protocol transition, not a password reset.',
  ],
  'features/album/protocol-trust.ts': [
    'Devices have identities and trust anchors; enrollment is explicit.',
  ],
  'docs/product/first-use-acceptance.md': [
    'The product requires pending, failed, and saved states to be distinguishable.',
    'The owner\'s physical two-phone acceptance run remains the gate for native UX.',
  ],
  'docs/product/relationship-home-and-archive.md': [
    'Us and Memories are intentionally separate destinations; sky photos are not dated memories.',
    'Free and Plus see the same relationship home.',
  ],
};

function normalize(text) {
  return text.toLowerCase();
}

function scoreTemplate(template, observation) {
  let score = 0;
  if (observation.signals.includes(template.key)) score += 10;
  for (const signal of observation.signals) {
    if (template.signals.includes(signal)) score += 10;
  }
  const text = normalize(observation.text);
  for (const keyword of template.keywords) {
    if (text.includes(normalize(keyword))) score += 2;
  }
  return score;
}

function pickTemplate(observation) {
  const ranked = TEMPLATES.map((template) => ({ template, score: scoreTemplate(template, observation) }))
    .sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  if (!winner || winner.score < 10) return null;
  return winner.template;
}

function codeFactsFor(files) {
  const facts = [];
  for (const file of files) {
    for (const fact of CODE_FACTS[file] ?? []) {
      if (!facts.includes(fact)) facts.push(fact);
    }
  }
  return facts.slice(0, 6);
}

function provenanceFor(bundle) {
  if (bundle.mode === 'live') return 'live_simulation';
  if (bundle.mode === 'local_oasis') return 'local_oasis';
  return 'offline_fixture';
}

export function extractScenarios(bundle, { personas, repoRoot = labPaths().repoRoot, strict = true, provenanceOverride, minimum = 12, requireAllGroups = true } = {}) {
  const personaById = new Map((personas?.personas ?? []).map((person) => [person.id, person]));
  const observations = bundle.observations ?? [];
  const selected = [];
  const unclassified = [];

  for (const observation of observations) {
    const template = pickTemplate(observation);
    if (!template) {
      unclassified.push(observation.id);
      continue;
    }
    const actor = personaById.get(observation.persona_id);
    if (!actor) {
      unclassified.push(observation.id);
      continue;
    }
    const partner = personaById.get(actor.partnerId);
    const key = `${template.key}:${[actor.id, partner?.id].filter(Boolean).sort().join('+')}`;
    const existing = selected.find((entry) => entry.key === key);
    if (existing) {
      if (!existing.observationIds.includes(observation.id)) existing.observationIds.push(observation.id);
      existing.observations.push(observation);
      continue;
    }
    selected.push({
      key,
      template,
      actor,
      partner,
      observationIds: [observation.id],
      observations: [observation],
    });
  }

  const scenarios = selected.map((entry, index) => {
    const { template, actor, partner, observations: sourceObservations } = entry;
    const id = `AOI-SIM-${String(index + 1).padStart(3, '0')}`;
    const quotes = sourceObservations.map(
      (observation) =>
        `A fictional participant (${personaById.get(observation.persona_id)?.displayName ?? observation.persona_id}) said: "${observation.text}"`
    );
    const assumptions = [actor, partner]
      .filter(Boolean)
      .flatMap((person) => person.assumptions.map((assumption) => `${person.displayName} assumes: ${assumption}`));
    return {
      schemaVersion: 'aoi-scenario/1',
      id,
      title: template.title,
      experiment: template.experiment,
      source: {
        aoi_commit: bundle.provenance.aoi_commit,
        mirofish_commit: bundle.provenance.mirofish_commit,
        simulation_id: bundle.provenance.simulation_id,
        observation_ids: entry.observationIds,
        provenance: provenanceOverride ?? provenanceFor(bundle),
        seed_version: bundle.provenance.seed_version,
      },
      actors: [actor, partner].filter(Boolean).map((person) => person.id),
      preconditions: template.preconditions,
      actions: template.actions.map((action) => ({ ...action })),
      expected_behavior: template.expected,
      candidate_failure_modes: template.failures,
      relevant_source_files: template.sourceFiles,
      existing_test_coverage: [],
      confidence: 'hypothesis',
      execution_target: template.executionTarget,
      status: template.execution ? 'mapped' : template.executionTarget === 'native' ? 'not_automatable' : 'proposed',
      claims: {
        observed_code_behavior: codeFactsFor(template.sourceFiles),
        documented_requirement: template.expected,
        hypothetical_user_behavior: [...quotes, ...assumptions].slice(0, 8),
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
      ...(template.execution
        ? {
            execution: {
              target: template.execution.target,
              test_path: template.execution.testPath,
              assertions: template.execution.assertions,
            },
          }
        : {}),
      // Internal metadata used by the coverage analyzer; stripped before writing.
      template,
      actor,
      partner,
      observationIds: entry.observationIds,
      _coverageProbes: template.probes ?? [],
      _templateKey: template.key,
    };
  });

  const publicScenarios = scenarios.map(({ template, actor, partner, observationIds, _coverageProbes, _templateKey, ...scenario }) => scenario);
  const validation = validateScenarioSet(publicScenarios, {
    repoRoot,
    knownPersonas: personaById,
    minimum,
    requireAllGroups,
  });
  if (strict && !validation.ok) {
    const error = new Error(`Scenario validation failed:\n${validation.errors.join('\n')}`);
    error.errors = validation.errors;
    throw error;
  }
  return { scenarios: publicScenarios, internal: scenarios, unclassified, validation };
}
