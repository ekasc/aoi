import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeOasisRaw } from '../src/observe.mjs';
import { buildOasisConfig, buildOasisProfiles } from '../src/oasis.mjs';
import { loadPersonas } from '../src/pipeline.mjs';
import { validateSimulationBundle } from '../src/validate.mjs';

const personas = loadPersonas();
const couple = personas.couples[0];
const personaById = new Map(personas.personas.map((person) => [person.id, person]));

test('OASIS profiles contain exactly two people and no MBTI-based behavior', () => {
  const profiles = buildOasisProfiles(couple, personaById);
  assert.equal(profiles.length, 2);
  assert.deepEqual(profiles.map((profile) => profile.user_id), [0, 1]);
  assert.ok(profiles.every((profile) => profile.mbti === ''));
  assert.ok(profiles.every((profile) => profile.persona.includes('fictional')));
});

test('OASIS config activates both people for each round and seeds one post', () => {
  const profiles = buildOasisProfiles(couple, personaById);
  const config = buildOasisConfig({
    couple,
    profiles,
    rounds: 3,
    model: 'test-model',
    group: 'A',
  });
  assert.equal(config.time_config.minutes_per_round, 30);
  assert.equal(config.time_config.total_simulation_hours, 2);
  assert.equal(config.agent_configs.length, 2);
  assert.equal(config.agent_configs[0].activity_level, 1.0);
  assert.equal(config.agent_configs[0].active_hours.length, 24);
  assert.equal(config.event_config.initial_posts.length, 1);
  assert.match(config.event_config.initial_posts[0].content, /invitation/i);
});

test('raw OASIS output normalizes to a labelled local_oasis bundle', () => {
  const raw = {
    schemaVersion: 'aoi-oasis-raw/1',
    simulation_id: 'oasis-couple-01-test',
    couple_id: couple.id,
    model: 'test-model',
    rounds: 2,
    started_at: '2026-10-23T00:00:00Z',
    finished_at: '2026-10-23T00:05:00Z',
    agent_map: { '0': couple.members[0], '1': couple.members[1] },
    posts: [
      {
        agent_id: 0,
        content:
          'I shared the invitation with my partner and assumed we were connected. The app never told me whether the other person had joined.',
        created_at: '2026-10-23T00:01:00Z',
      },
    ],
    comments: [
      {
        agent_id: 1,
        post_id: 1,
        content:
          'I did not know I had to join. I thought creating the space was enough and that my partner would appear automatically.',
        created_at: '2026-10-23T00:02:00Z',
      },
    ],
  };
  const bundle = normalizeOasisRaw(raw, {
    personas,
    aoiCommit: '048f78383a2ff423a8b3c1f0532c4514b387708f',
    mirofishCommit: '7657031ac01184afe2cb220f5ee3545573b5e843',
    seedVersion: 'seeds-v1',
  });
  assert.equal(bundle.mode, 'local_oasis');
  assert.equal(bundle.live, false);
  assert.match(bundle.provenance.label, /not a mirofish/i);
  assert.ok(bundle.observations.length >= 1);
  assert.ok(bundle.observations.every((observation) => ['p-alice', 'p-bob'].includes(observation.persona_id)));
  const validation = validateSimulationBundle(bundle, {
    knownPersonas: new Set(personas.personas.map((person) => person.id)),
  });
  assert.equal(validation.ok, true, validation.errors.join('\n'));
});
