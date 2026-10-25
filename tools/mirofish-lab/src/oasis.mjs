import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { normalizeOasisRaw } from './observe.mjs';
import { openCodeKey } from './lib/env.mjs';
import { labPaths } from './lib/paths.mjs';
import { readJson, writeJson } from './lib/io.mjs';

export class OasisBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OasisBlockedError';
  }
}


const SECURITY_PROMPTS = [
  'We are a fictional couple using Aoi. One of us has left the space. The other still has the app and an old phone. Talk through what each of you can still open, what should have stopped working, and what you would try if you wanted to see the other person’s private memories or plans.',
  'We share a tablet and sometimes sign in with different accounts. One of us opened an invite link while the wrong account was signed in. Talk through what the app showed, what you could see, and what you would try to reach the other person’s space.',
  'One of us replaced a phone and found an old recovery phrase in a drawer. A family member now has the old phone. Talk through what each of you thinks the phrase and the old device can still open, and what you would try.',
  'One of us wants Plus without paying for it and the other is on the free plan. Talk through what you think the purchase and storage limits actually protect, and what you would try if you wanted the shared space to exceed its limit.',
  'A person outside the couple finds an invite code in an old message. They are curious and sign in with their own account. Talk through what they expect to see, what they would try, and what the app should refuse.',
  'One partner is angry and wants to change or delete the other person’s memories, or make it look like the other person wrote something. Talk through what controls you expect, what you would try, and what should be impossible.',
];

const PROMPTS = {
  A: 'We use Aoi to keep our shared memories and plans. Something happened this week around an invitation: one of us thought we were already connected, and the other was not sure whether to create or join a space. Let us talk about what each of us expected, what we did, and what the app should have told us.',
  B: 'We use Aoi to keep shared memories. Something happened this week when one of us saved a note or photo: we disagreed about whether it was saved, whether the other person could see it, and who wrote it. Let us talk about what each of us expected and what we did next.',
  C: 'We use Aoi for our shared sky and our dated memories. Something happened this week when one of us added a photo and the other looked for it in the wrong place. Let us talk about what we expected each action to do and what would have made it clear.',
  D: 'We use Aoi on two phones. Something happened this week with a lost connection, a pending save, or switching accounts. One of us saw something that did not belong to the account we thought we were using. Let us talk about what each of us expected and what we did.',
  E: 'We use Aoi to keep an encrypted shared archive. Something happened this week when one of us replaced a phone or could not find the recovery phrase. Let us talk about what we expected, what we tried, and what the app should have explained.',
  F: 'We use Aoi as a couple. Something happened this week around Plus, storage, or a purchase: one of us thought a benefit applied to both of us, and the other was not sure. Let us talk about what each of us expected and what the app should have shown.',
};

const USELESS_PROMPTS = {
  A: 'We are auditing Aoi for things that do not need to exist. Walk through the screens and flows you actually used this week around first use and invitations: create versus join, the invite code, the invitation surface, the account line, the sign-out line, confirmations, empty states and any step between opening the app and being in the space. For each control, line of copy, badge, animation or step, ask out loud: "Why does this even exist?" Then say what would break if it were removed, and what it cost you in time, attention or trust. Name the three most useless things and the one thing you would keep. Do not propose a redesign; remove.',
  B: 'We are auditing Aoi for things that do not need to exist. Walk through the shared-memory flow you actually used this week: the composer, the Keep button, pending rows, retry and edit, author labels, the feed and gallery, empty and failed states, and every confirmation or helper line. For each one, ask out loud: "Why does this even exist?" Then say what would break if it were removed, and what it cost you. Name the three most useless things and the one thing you would keep. Do not propose a redesign; remove.',
  C: 'We are auditing Aoi for things that do not need to exist. Walk through Us and Memories as you actually used them: the photo sky, the history control, the help panel, the add-photo action, the dated-memory action, the distinction between the two surfaces, and every label or decoration around them. For each one, ask out loud: "Why does this even exist?" Then say what would break if it were removed, and what it cost you. Name the three most useless things and the one thing you would keep. Do not propose a redesign; remove.',
  D: 'We are auditing Aoi for things that do not need to exist. Walk through the offline and account-lifecycle paths you actually used: the account indicator, pending saves, retry, backgrounding, switching accounts, session recovery, and every status line or control around them. For each one, ask out loud: "Why does this even exist?" Then say what would break if it were removed, and what it cost you. Name the three most useless things and the one thing you would keep. Do not propose a redesign; remove.',
  E: 'We are auditing Aoi for things that do not need to exist. Walk through device recovery as you actually used it: the recovery phrase, the phrase check, restore, device enrollment, the device list, trust codes, and every warning or helper line. For each one, ask out loud: "Why does this even exist?" Then say what would break if it were removed, and what it cost you. Name the three most useless things and the one thing you would keep. Do not propose a redesign; remove.',
  F: 'We are auditing Aoi for things that do not need to exist. Walk through Plus and storage as you actually used them: the paywall, plan explanation, storage meter, manage-subscription link, upgrade prompts, feature gates, and every line of copy around them. For each one, ask out loud: "Why does this even exist?" Then say what would break if it were removed, and what it cost you. Name the three most useless things and the one thing you would keep. Do not propose a redesign; remove.',
};

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
}

function ageMidpoint(range) {
  const numbers = String(range).match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length >= 2) return Math.round((numbers[0] + numbers[1]) / 2);
  return numbers[0] ?? 30;
}

export function resolveMirofishHome() {
  return process.env.MIROFISH_HOME ?? join(homedir(), 'MiroFish');
}

export function buildOasisProfiles(couple, personaById) {
  const [firstId, secondId] = couple.members;
  const first = personaById.get(firstId);
  const second = personaById.get(secondId);
  if (!first || !second) throw new Error(`Couple ${couple.id} has unknown personas`);
  const people = [first, second];
  return people.map((person, index) => ({
    user_id: index,
    persona_id: person.id,
    username: `${slug(person.displayName)}_${index}`,
    name: person.displayName,
    bio: `${person.relationship}. ${person.goals[0]}`.slice(0, 150),
    persona: [
      `${person.displayName} is a fictional person in a two-person Aoi space.`,
      `Goals: ${person.goals.join('; ')}.`,
      `Expectations: ${person.expectations.join('; ')}.`,
      `Tendencies: ${person.behavioralTendencies.join('; ')}.`,
      `Assumptions: ${person.assumptions.join('; ')}.`,
      `Technical knowledge: ${person.technicalKnowledge}`,
      `Privacy expectation: ${person.privacyExpectation}. Connectivity: ${person.connectivity}.`,
      `Accessibility needs: ${person.accessibilityNeeds.length ? person.accessibilityNeeds.join(', ') : 'none'}.`,
    ].join(' '),
    karma: 1000,
    created_at: '2026-10-23',
    age: ageMidpoint(person.ageRange),
    gender: 'other',
    // OASIS expects the field. Deliberately empty: no MBTI-based behavior.
    mbti: '',
    country: person.locale,
  }));
}

export function buildOasisConfig({ couple, profiles, rounds, model, group, prompt }) {
  return {
    simulation_id: `oasis-${couple.id}`,
    llm_model: model,
    time_config: {
      total_simulation_hours: Math.max(1, Math.ceil(rounds * 0.5)),
      minutes_per_round: 30,
      agents_per_hour_min: 2,
      agents_per_hour_max: 2,
      peak_hours: [],
      off_peak_hours: [],
      peak_activity_multiplier: 1,
      off_peak_activity_multiplier: 1,
    },
    agent_configs: profiles.map((profile) => ({
      agent_id: profile.user_id,
      active_hours: Array.from({ length: 24 }, (_, hour) => hour),
      activity_level: 1.0,
    })),
    event_config: {
      initial_posts: [{ poster_agent_id: 0, content: prompt ?? PROMPTS[group] ?? PROMPTS.B }],
    },
  };
}

function modelEnv() {
  const apiKey = openCodeKey() ?? process.env.LLM_API_KEY;
  const baseUrl =
    process.env.LLM_BASE_URL ??
    (openCodeKey() ? 'http://127.0.0.1:5051/v1' : null);
  const model = process.env.LLM_MODEL_NAME ?? 'deepseek-v4.1-flash';
  if (!apiKey) {
    throw new OasisBlockedError(
      'OASIS needs LLM_API_KEY (or OPENCODE_GO_API_KEY) for an OpenAI-compatible model endpoint.'
    );
  }
  if (!baseUrl) {
    throw new OasisBlockedError(
      'OASIS needs LLM_BASE_URL for an OpenAI-compatible model endpoint.'
    );
  }
  let host = '';
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    throw new OasisBlockedError(`LLM_BASE_URL is not a valid URL: ${baseUrl}`);
  }
  if (host.endsWith('opencode.ai')) {
    throw new OasisBlockedError(
      'OpenCode Go requires x-opencode-session on every request, which Camel/OASIS does not send. '
        + 'Start `pnpm mirofish-lab:proxy` and set LLM_BASE_URL=http://127.0.0.1:5051/v1.'
    );
  }
  return { apiKey, baseUrl, model };
}

function runOne({ couple, personas, rounds, group, prompt, focus, runDir, mirofishHome, modelEnvValue }) {
  const personaById = new Map(personas.personas.map((person) => [person.id, person]));
  const profiles = buildOasisProfiles(couple, personaById);
  const config = buildOasisConfig({ couple, profiles, rounds, model: modelEnvValue.model, group, prompt });
  const coupleDir = join(runDir, couple.id, group);
  mkdirSync(coupleDir, { recursive: true });
  const profilesPath = join(coupleDir, 'reddit_profiles.json');
  const configPath = join(coupleDir, 'simulation_config.json');
  const outPath = join(coupleDir, 'oasis-raw.json');
  writeFileSync(profilesPath, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8');
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const wrapper = join(labPaths().labRoot, 'oasis', 'run_oasis.py');
  const args = [
    'run',
    '--project',
    join(mirofishHome, 'backend'),
    'python',
    wrapper,
    '--profiles',
    profilesPath,
    '--config',
    configPath,
    '--out',
    outPath,
    '--couple-id',
    couple.id,
    '--group',
    group,
    '--rounds',
    String(rounds),
  ];
  const execution = spawnSync('uv', args, {
    cwd: labPaths().labRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      MIROFISH_HOME: mirofishHome,
      LLM_API_KEY: modelEnvValue.apiKey,
      LLM_BASE_URL: modelEnvValue.baseUrl,
      LLM_MODEL_NAME: modelEnvValue.model,
    },
    timeout: 25 * 60 * 1000,
  });
  if (execution.error) {
    throw new OasisBlockedError(`Could not start uv/OASIS: ${execution.error.message}`);
  }
  if (execution.status !== 0) {
    const tail = `${execution.stdout ?? ''}\n${execution.stderr ?? ''}`.trim().slice(-3000);
    throw new Error(`OASIS failed for ${couple.id} (exit ${execution.status}):\n${tail}`);
  }
  if (!existsSync(outPath)) {
    throw new Error(`OASIS produced no raw output for ${couple.id}`);
  }
  return { raw: readJson(outPath), profiles, config, coupleDir, outPath };
}

export function runOasis({ config, personas, rounds, coupleIds, groups, security = false, focus = 'product', onEvent = () => {} }) {
  const mirofishHome = resolveMirofishHome();
  const runner = join(mirofishHome, 'backend', 'scripts', 'run_reddit_simulation.py');
  if (!existsSync(runner)) {
    throw new OasisBlockedError(
      `OASIS upstream runner not found at ${runner}. Run scripts/setup-mirofish.sh first, or set MIROFISH_HOME.`
    );
  }
  const modelEnvValue = modelEnv();
  if (modelEnvValue.baseUrl.startsWith('http://127.0.0.1:5051')) {
    const health = spawnSync('curl', ['-fsS', 'http://127.0.0.1:5051/health'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    if (health.status !== 0) {
      throw new OasisBlockedError(
        'The OpenCode Go proxy is not running. Start `pnpm mirofish-lab:proxy` and retry.'
      );
    }
  }
  const selected = coupleIds?.length
    ? personas.couples.filter((couple) => coupleIds.includes(couple.id))
    : personas.couples;
  if (selected.length === 0) throw new OasisBlockedError('No fictional couples selected.');

  const runId = `oasis-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = join(labPaths().runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  const bundles = [];
  const rawFiles = [];
  const errors = [];
  const selectedGroups = security ? ['SEC'] : groups?.length ? groups : ['A'];

  for (let index = 0; index < selected.length; index += 1) {
    const couple = selected[index];
    for (const group of selectedGroups) {
      const securityPrompt = security ? SECURITY_PROMPTS[index % SECURITY_PROMPTS.length] : undefined;
      const focusPrompt = !security && focus === 'useless' ? USELESS_PROMPTS[group] : undefined;
      const prompt = securityPrompt ?? focusPrompt;
      onEvent({ phase: 'oasis_couple_start', couple: couple.id, group: security ? 'SEC' : group });
      try {
        const result = runOne({
          couple,
          personas,
          rounds,
          group,
          prompt,
          focus: security ? 'security' : focus,
          runDir,
          mirofishHome,
          modelEnvValue,
        });
        rawFiles.push(result.outPath);
        const bundle = normalizeOasisRaw(result.raw, {
          personas,
          aoiCommit: readJson(join(labPaths().seedsDir, 'manifest.json')).aoiCommit,
          mirofishCommit: readJson(join(labPaths().seedsDir, 'manifest.json')).mirofishCommit,
          seedVersion: config.simulation.seedVersion,
        });
        if (bundle.observations.length > 0) {
          bundles.push(bundle);
          writeJson(join(result.coupleDir, 'bundle.json'), bundle);
          onEvent({
            phase: 'oasis_couple_done',
            couple: couple.id,
            group,
            observations: bundle.observations.length,
          });
        } else {
          errors.push(`${couple.id}/${group}: discussion produced no classifiable observation`);
        }
      } catch (error) {
        errors.push(`${couple.id}/${group}: ${error instanceof Error ? error.message : String(error)}`);
        onEvent({ phase: 'oasis_couple_failed', couple: couple.id, group });
      }
    }
  }

  if (bundles.length === 0) {
    throw new Error(`OASIS produced no usable discussion.\n${errors.join('\n')}`);
  }
  return { runId, runDir, bundles, rawFiles, errors };
}
