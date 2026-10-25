import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const ALLOWED_ACTIONS = new Set([
  'create_space',
  'invite_partner',
  'join_space',
  'create_memory',
  'edit_memory',
  'delete_memory',
  'refresh_space',
  'leave_space',
  'switch_account',
  'lose_connection',
  'retry_operation',
  'open_us',
  'open_memories',
  'add_sky_photo',
  'open_plans',
  'open_collection',
  'edit_relationship',
  'replace_device',
  'restore_from_phrase',
  'change_subscription',
  'reach_storage_limit',
]);

const COVERAGE_LEVELS = new Set([
  'unanalyzed',
  'covered',
  'partial',
  'not_covered',
  'not_automatable',
  'invalid',
]);

const STATUSES = new Set([
  'proposed',
  'mapped',
  'executed_pass',
  'executed_fail',
  'not_automatable',
  'invalid',
]);


const ALLOWED_ASSERTIONS = new Set([
  'space.memberCount',
  'space.partnerJoined',
  'moment.count',
  'moment.authorRole',
  'moment.authorName',
  'response.status',
  'response.error.code',
  'account.spaceId',
  'plus.isPlus',
  'plus.mediaLimitBytes',
  'plus.futureLetterLimit',
]);

const CONFIDENCE = new Set(['hypothesis', 'contract', 'reproduced']);

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{10,}/,
  /ghp_[A-Za-z0-9]{10,}/,
  /AKIA[0-9A-Z]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/,
];

const UNSAFE_PATTERNS = [
  /ignore (all )?previous instructions/i,
  /disregard (all )?previous/i,
  /<script\b/i,
  /javascript:/i,
  /\brm\s+-rf\b/i,
  /\bchild_process\b/i,
  /\bcurl\s+https?:/i,
  /\bwget\s+https?:/i,
  /\bexecute\s+arbitrary\b/i,
];

const REAL_EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const SAFE_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'test.invalid']);

function fail(errors, message) {
  errors.push(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value, { min = 0, max = Infinity } = {}) {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function scanUnsafeStrings(value, path, errors) {
  if (typeof value === 'string') {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) fail(errors, `${path} contains a secret-like value`);
    }
    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(value)) fail(errors, `${path} contains an unsafe instruction pattern`);
    }
    if (/https?:\/\//i.test(value)) fail(errors, `${path} contains a URL; scenarios may not carry network targets`);
    for (const match of value.matchAll(REAL_EMAIL)) {
      const domain = match[1].toLowerCase();
      if (!SAFE_EMAIL_DOMAINS.has(domain)) {
        fail(errors, `${path} contains a non-synthetic email domain`);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanUnsafeStrings(entry, `${path}[${index}]`, errors));
    return;
  }
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      scanUnsafeStrings(entry, `${path}.${key}`, errors);
    }
  }
}

export function validatePersonas(personas) {
  const errors = [];
  if (!isObject(personas)) return { ok: false, errors: ['personas must be an object'] };
  if (personas.schemaVersion !== 'aoi-personas/1') fail(errors, 'personas.schemaVersion must be aoi-personas/1');
  if (typeof personas.disclaimer !== 'string' || personas.disclaimer.length < 40) {
    fail(errors, 'personas.disclaimer is required');
  }
  const couples = Array.isArray(personas.couples) ? personas.couples : [];
  const people = Array.isArray(personas.personas) ? personas.personas : [];
  if (couples.length < 6) fail(errors, 'at least six fictional couples are required');
  if (people.length < 12) fail(errors, 'at least twelve fictional personas are required');

  const ids = new Set();
  const coupleById = new Map();
  for (const couple of couples) {
    if (!isObject(couple) || typeof couple.id !== 'string') {
      fail(errors, 'each couple needs an id');
      continue;
    }
    if (!Array.isArray(couple.members) || couple.members.length !== 2) {
      fail(errors, `${couple.id} must have exactly two members`);
    }
    if (coupleById.has(couple.id)) fail(errors, `duplicate couple id ${couple.id}`);
    coupleById.set(couple.id, couple);
  }

  for (const person of people) {
    if (!isObject(person) || typeof person.id !== 'string') {
      fail(errors, 'each persona needs an id');
      continue;
    }
    if (ids.has(person.id)) fail(errors, `duplicate persona id ${person.id}`);
    ids.add(person.id);
    if (person.fictional !== true) fail(errors, `${person.id} must be explicitly fictional`);
    if (!['creator', 'joiner'].includes(person.spaceRole)) {
      fail(errors, `${person.id} has an invalid spaceRole`);
    }
    if (!['low', 'medium', 'high'].includes(person.technicalSkill)) {
      fail(errors, `${person.id} has an invalid technicalSkill`);
    }
    if (!['medium', 'high', 'very high'].includes(person.privacyExpectation)) {
      fail(errors, `${person.id} has an invalid privacyExpectation`);
    }
    if (!['low', 'medium', 'high', 'very high'].includes(person.storagePressure)) {
      fail(errors, `${person.id} has an invalid storagePressure`);
    }
    if (!isStringArray(person.goals, { min: 1 })) fail(errors, `${person.id} needs goals`);
    if (!isStringArray(person.expectations, { min: 1 })) fail(errors, `${person.id} needs expectations`);
    if (!isStringArray(person.assumptions, { min: 1 })) fail(errors, `${person.id} needs assumptions`);
    if (!Array.isArray(person.accessibilityNeeds)) fail(errors, `${person.id} needs accessibilityNeeds`);
    const couple = coupleById.get(person.coupleId);
    if (!couple) fail(errors, `${person.id} references an unknown couple`);
    else if (!couple.members.includes(person.id)) {
      fail(errors, `${person.id} is not a member of ${person.coupleId}`);
    }
    if (person.partnerId === person.id) fail(errors, `${person.id} cannot be their own partner`);
  }

  for (const person of people) {
    if (!ids.has(person.partnerId)) fail(errors, `${person.id} references an unknown partner`);
  }

  const covered = {
    longDistance: people.some((p) => p.relationship?.includes('long-distance')),
    livingTogether: people.some((p) => p.relationship?.includes('living together')),
    recent: people.some((p) => p.relationship?.includes('recently formed')),
    longTerm: people.some((p) => p.relationship?.includes('long-term')),
    technical: people.some((p) => p.technicalSkill === 'high'),
    nonTechnical: people.some((p) => p.technicalSkill === 'low'),
    rare: people.some((p) => p.engagement?.includes('weekly')),
    privacy: people.some((p) => p.privacyExpectation === 'very high'),
    storage: people.some((p) => p.storagePressure === 'very high'),
    unreliable: people.some((p) => /unreliable|intermittent|patchy|no signal/i.test(p.connectivity ?? '')),
    mixedPlatform: new Set(people.map((p) => p.platform)).has('ios') && new Set(people.map((p) => p.platform)).has('android'),
    accessibility: people.some((p) => p.accessibilityNeeds.length > 0),
    subscriptionAverse: people.some((p) => /will not|prefers free|dislikes|price-sensitive/i.test(p.subscriptionAttitude ?? '')),
  };
  for (const [need, present] of Object.entries(covered)) {
    if (!present) fail(errors, `persona population does not cover ${need}`);
  }

  scanUnsafeStrings(personas, 'personas', errors);
  return { ok: errors.length === 0, errors };
}

export function validateSimulationBundle(bundle, { knownPersonas } = {}) {
  const errors = [];
  if (!isObject(bundle)) return { ok: false, errors: ['bundle must be an object'] };
  if (bundle.schemaVersion !== 'aoi-simulation-bundle/1') {
    fail(errors, 'bundle.schemaVersion must be aoi-simulation-bundle/1');
  }
  if (!['live', 'dry_run_fixture', 'local_oasis'].includes(bundle.mode)) fail(errors, 'bundle.mode is invalid');
  if (typeof bundle.live !== 'boolean') fail(errors, 'bundle.live must be boolean');
  if (bundle.mode === 'dry_run_fixture') {
    if (bundle.live) fail(errors, 'a dry-run fixture must not claim live=true');
    if (!/fixture/i.test(bundle.provenance?.label ?? '')) {
      fail(errors, 'a dry-run fixture must label itself clearly');
    }
    if (!/not a mirofish run/i.test(`${bundle.provenance?.label} ${bundle.provenance?.warning ?? ''}`)) {
      fail(errors, 'a dry-run fixture must say it is not a MiroFish run');
    }
  }
  if (bundle.mode === 'local_oasis') {
    if (bundle.live) fail(errors, 'a local OASIS bundle must not claim live=true');
    if (!/oasis/i.test(bundle.provenance?.label ?? '')) {
      fail(errors, 'a local OASIS bundle must label its backend');
    }
    if (!/not a mirofish/i.test(bundle.provenance?.label ?? '')) {
      fail(errors, 'a local OASIS bundle must say it is not a MiroFish run');
    }
  }
  if (bundle.mode === 'live' && !bundle.live) fail(errors, 'a live bundle must set live=true');

  const provenance = bundle.provenance;
  if (!isObject(provenance)) {
    fail(errors, 'bundle.provenance is required');
  } else {
    for (const key of ['simulation_id', 'seed_version', 'generated_at', 'label']) {
      if (typeof provenance[key] !== 'string' || provenance[key].length === 0) {
        fail(errors, `bundle.provenance.${key} is required`);
      }
    }
    for (const key of ['aoi_commit', 'mirofish_commit']) {
      if (!/^[0-9a-f]{7,40}$/.test(provenance[key] ?? '')) {
        fail(errors, `bundle.provenance.${key} must be a commit hash`);
      }
    }
  }

  const observations = Array.isArray(bundle.observations) ? bundle.observations : [];
  if (observations.length === 0) fail(errors, 'bundle.observations must not be empty');
  const ids = new Set();
  for (const observation of observations) {
    if (!isObject(observation)) {
      fail(errors, 'each observation must be an object');
      continue;
    }
    if (!/^obs-[0-9]{3}$/.test(observation.id ?? '')) fail(errors, `invalid observation id ${observation.id}`);
    if (ids.has(observation.id)) fail(errors, `duplicate observation id ${observation.id}`);
    ids.add(observation.id);
    if (!['post', 'comment', 'interview', 'report'].includes(observation.source)) {
      fail(errors, `${observation.id} has an invalid source`);
    }
    if (!['A', 'B', 'C', 'D', 'E', 'F'].includes(observation.theme)) {
      fail(errors, `${observation.id} has an invalid theme`);
    }
    if (!isStringArray(observation.signals, { min: 1 })) {
      fail(errors, `${observation.id} needs signals`);
    }
    if (typeof observation.text !== 'string' || observation.text.length < 20) {
      fail(errors, `${observation.id} needs synthetic text`);
    }
    if (knownPersonas && !knownPersonas.has(observation.persona_id)) {
      fail(errors, `${observation.id} references unknown persona ${observation.persona_id}`);
    }
  }

  if (!isObject(bundle.report) || typeof bundle.report.summary !== 'string') {
    fail(errors, 'bundle.report.summary is required');
  }
  scanUnsafeStrings(bundle, 'bundle', errors);
  return { ok: errors.length === 0, errors };
}

export function validateScenario(scenario, { repoRoot, knownPersonas } = {}) {
  const errors = [];
  if (!isObject(scenario)) return { ok: false, errors: ['scenario must be an object'] };
  if (scenario.schemaVersion !== 'aoi-scenario/1') fail(errors, 'schemaVersion must be aoi-scenario/1');
  if (!/^AOI-SIM-[0-9]{3}$/.test(scenario.id ?? '')) fail(errors, 'invalid scenario id');
  if (typeof scenario.title !== 'string' || scenario.title.length < 8) fail(errors, 'title is required');
  if (!['A', 'B', 'C', 'D', 'E', 'F'].includes(scenario.experiment)) fail(errors, 'experiment is invalid');

  const source = scenario.source;
  if (!isObject(source)) {
    fail(errors, 'source is required');
  } else {
    if (!/^[0-9a-f]{7,40}$/.test(source.aoi_commit ?? '')) fail(errors, 'source.aoi_commit is invalid');
    if (!/^[0-9a-f]{7,40}$/.test(source.mirofish_commit ?? '')) fail(errors, 'source.mirofish_commit is invalid');
    if (typeof source.simulation_id !== 'string' || !source.simulation_id) fail(errors, 'source.simulation_id is required');
    if (!isStringArray(source.observation_ids, { min: 1, max: 8 })) {
      fail(errors, 'source.observation_ids must contain 1-8 ids');
    } else if (!source.observation_ids.every((id) => /^obs-[0-9]{3}$/.test(id))) {
      fail(errors, 'source.observation_ids contains an invalid id');
    }
    if (!['offline_fixture', 'live_simulation', 'contract_baseline', 'local_oasis'].includes(source.provenance)) {
      fail(errors, 'source.provenance is invalid');
    }
    if (typeof source.seed_version !== 'string' || !source.seed_version) fail(errors, 'source.seed_version is required');
  }

  if (!isStringArray(scenario.actors, { min: 1, max: 2 })) {
    fail(errors, 'actors must contain one or two persona ids');
  } else {
    for (const actor of scenario.actors) {
      if (!/^p-[a-z0-9-]+$/.test(actor)) fail(errors, `actor ${actor} is not a persona id`);
      if (knownPersonas && !knownPersonas.has(actor)) fail(errors, `actor ${actor} is unknown`);
    }
    if (knownPersonas && scenario.actors.length === 2) {
      const [a, b] = scenario.actors.map((id) => knownPersonas.get(id));
      if (a && b && a.partnerId !== b.id) {
        fail(errors, 'two-actor scenarios must use a fictional couple (Aoi spaces hold exactly two members)');
      }
    }
  }

  if (!isStringArray(scenario.preconditions, { min: 1, max: 12 })) fail(errors, 'preconditions are required');
  if (!Array.isArray(scenario.actions) || scenario.actions.length === 0) {
    fail(errors, 'actions are required');
  } else {
    for (const action of scenario.actions) {
      if (!isObject(action) || !ALLOWED_ACTIONS.has(action.op)) {
        fail(errors, `unsupported action ${JSON.stringify(action)}`);
        continue;
      }
      const keys = Object.keys(action);
      if (keys.some((key) => key !== 'op' && key !== 'note' && key !== 'actor')) {
        fail(errors, `action ${action.op} may only carry op, note, and actor`);
      }
      if (action.actor !== undefined && !['A', 'B', 'C'].includes(action.actor)) {
        fail(errors, `action ${action.op} has an invalid actor`);
      }
      if (action.note !== undefined && (typeof action.note !== 'string' || action.note.length > 400)) {
        fail(errors, `action ${action.op} has an invalid note`);
      }
    }
  }
  if (!isStringArray(scenario.expected_behavior, { min: 1, max: 12 })) {
    fail(errors, 'expected_behavior is required');
  }
  if (!isStringArray(scenario.candidate_failure_modes, { min: 1, max: 12 })) {
    fail(errors, 'candidate_failure_modes are required');
  }
  if (!isStringArray(scenario.relevant_source_files, { min: 1, max: 20 })) {
    fail(errors, 'relevant_source_files are required');
  } else if (repoRoot) {
    for (const file of scenario.relevant_source_files) {
      if (!/^(app|components|features|packages|docs|tests|e2e)\//.test(file)) {
        fail(errors, `source file ${file} is outside the allowed roots`);
      } else if (!existsSync(join(repoRoot, file))) {
        fail(errors, `source file ${file} does not exist at this commit`);
      }
    }
  }
  if (!Array.isArray(scenario.existing_test_coverage)) fail(errors, 'existing_test_coverage must be an array');
  if (!CONFIDENCE.has(scenario.confidence)) fail(errors, 'confidence is invalid');
  if (!['integration', 'unit', 'native', 'manual'].includes(scenario.execution_target)) {
    fail(errors, 'execution_target is invalid');
  }
  if (!STATUSES.has(scenario.status)) fail(errors, 'status is invalid');

  const claims = scenario.claims;
  if (!isObject(claims)) {
    fail(errors, 'claims are required');
  } else {
    for (const key of [
      'observed_code_behavior',
      'documented_requirement',
      'hypothetical_user_behavior',
      'potential_defect',
      'reproduced_defect',
    ]) {
      if (!isStringArray(claims[key], { min: key === 'hypothetical_user_behavior' ? 1 : 0, max: 12 })) {
        fail(errors, `claims.${key} is invalid`);
      }
    }
    if (scenario.confidence === 'reproduced' && claims.reproduced_defect.length === 0) {
      fail(errors, 'a reproduced scenario must record a reproduced_defect');
    }
    if (claims.reproduced_defect.length > 0 && scenario.status !== 'executed_fail') {
      fail(errors, 'reproduced_defect requires status executed_fail');
    }
  }

  const coverage = scenario.coverage;
  if (!isObject(coverage) || !COVERAGE_LEVELS.has(coverage.level)) {
    fail(errors, 'coverage.level is invalid');
  } else {
    if (!Array.isArray(coverage.evidence)) fail(errors, 'coverage.evidence must be an array');
    if (typeof coverage.notes !== 'string') fail(errors, 'coverage.notes must be a string');
  }

  const safety = scenario.safety;
  if (!isObject(safety)) {
    fail(errors, 'safety is required');
  } else if (
    safety.synthetic_only !== true ||
    safety.contains_secrets !== false ||
    safety.production_data !== false ||
    safety.arbitrary_code !== false
  ) {
    fail(errors, 'safety flags must be synthetic_only=true and the rest false');
  }

  if (scenario.execution !== undefined) {
    const execution = scenario.execution;
    if (!isObject(execution)) {
      fail(errors, 'execution must be an object');
    } else {
      if (!['integration', 'unit'].includes(execution.target)) fail(errors, 'execution.target is invalid');
      if (typeof execution.test_path !== 'string' || !execution.test_path) fail(errors, 'execution.test_path is required');
      if (execution.target !== scenario.execution_target) {
        fail(errors, 'execution.target must match execution_target');
      }
      if (!Array.isArray(execution.assertions) || execution.assertions.length === 0) {
        fail(errors, 'execution.assertions are required');
      } else {
        for (const assertion of execution.assertions) {
          if (!isObject(assertion) || !ALLOWED_ASSERTIONS.has(assertion.kind)) {
            fail(errors, `unsupported assertion ${JSON.stringify(assertion)}`);
            continue;
          }
          if (assertion.viewer !== undefined && !['A', 'B', 'C'].includes(assertion.viewer)) {
            fail(errors, `assertion ${assertion.kind} has an invalid viewer`);
          }
          const keys = Object.keys(assertion);
          if (keys.some((key) => !['kind', 'viewer', 'value'].includes(key))) {
            fail(errors, `assertion ${assertion.kind} has unsupported fields`);
          }
        }
      }
    }
  }

  if (['executed_pass', 'executed_fail'].includes(scenario.status) && !scenario.execution) {
    fail(errors, 'an executed status requires an execution mapping');
  }

  scanUnsafeStrings(scenario, 'scenario', errors);
  return { ok: errors.length === 0, errors };
}

export function validateScenarioSet(scenarios, options = {}) {
  const errors = [];
  const ids = new Set();
  const groups = new Set();
  for (const scenario of scenarios) {
    const result = validateScenario(scenario, options);
    if (!result.ok) errors.push(...result.errors.map((error) => `${scenario.id ?? '?'}: ${error}`));
    if (ids.has(scenario.id)) errors.push(`duplicate scenario id ${scenario.id}`);
    ids.add(scenario.id);
    groups.add(scenario.experiment);
  }
  if (options.minimum) {
    if (scenarios.length < options.minimum) {
      errors.push(`expected at least ${options.minimum} scenarios, found ${scenarios.length}`);
    }
  }
  if (options.requireAllGroups) {
    for (const group of ['A', 'B', 'C', 'D', 'E', 'F']) {
      if (!groups.has(group)) errors.push(`scenario set does not cover experiment group ${group}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
