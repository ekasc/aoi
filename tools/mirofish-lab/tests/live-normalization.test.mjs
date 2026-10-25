import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeLiveBundle } from '../src/observe.mjs';
import { loadPersonas } from '../src/pipeline.mjs';

test('raw MiroFish responses normalize into a live bundle with mapped personas', () => {
  const personas = loadPersonas();
  const bundle = normalizeLiveBundle({
    simulationId: 'sim-test-1',
    aoiCommit: '048f78383a2ff423a8b3c1f0532c4514b387708f',
    mirofishCommit: '7657031ac01184afe2cb220f5ee3545573b5e843',
    seedVersion: 'seeds-v1',
    baseUrl: 'http://127.0.0.1:5001',
    model: 'qwen-plus',
    roundsRun: 4,
    repeatIndex: 0,
    personas,
    profilesResponse: {
      data: {
        profiles: [
          { user_id: 0, name: 'Alice Moreau', username: 'alice_moreau', bio: 'Designer in Montreal' },
          { user_id: 1, name: 'Unknown Person', username: 'unknown', bio: 'Not in the synthetic population' },
        ],
      },
    },
    actionsResponse: { data: { actions: [] } },
    postsResponse: {
      data: {
        posts: [
          {
            user_id: 0,
            round_num: 2,
            content:
              'I shared the invitation with Bob and assumed we were connected. The app never told me whether he had joined.',
          },
        ],
      },
    },
    commentsResponse: { data: { comments: [] } },
    interviewsResponse: {
      data: {
        result: {
          results: {
            reddit_0: {
              agent_id: 0,
              response: 'I keep looking for the photo in Memories even though I added it to the sky.',
            },
          },
        },
      },
    },
    reportResponse: {
      data: { summary: 'A synthetic report summary.', sections: [{ title: 'Invitations', content: 'Sharing is not joining.' }] },
    },
  });

  assert.equal(bundle.mode, 'live');
  assert.equal(bundle.live, true);
  assert.ok(bundle.observations.length >= 1);
  assert.ok(bundle.observations.every((observation) => observation.persona_id === 'p-alice'));
  assert.ok(bundle.observations.some((observation) => observation.theme === 'A'));
  assert.match(bundle.report.summary, /synthetic report/i);
});

test('unmatched MiroFish profiles are dropped rather than assigned a fake persona', () => {
  const personas = loadPersonas();
  const bundle = normalizeLiveBundle({
    simulationId: 'sim-test-2',
    aoiCommit: '048f78383a2ff423a8b3c1f0532c4514b387708f',
    mirofishCommit: '7657031ac01184afe2cb220f5ee3545573b5e843',
    seedVersion: 'seeds-v1',
    baseUrl: 'http://127.0.0.1:5001',
    model: 'qwen-plus',
    roundsRun: 1,
    repeatIndex: 0,
    personas,
    profilesResponse: {
      data: { profiles: [{ user_id: 7, name: 'Nobody Known', username: 'nobody', bio: 'Not in the population' }] },
    },
    actionsResponse: { data: { actions: [] } },
    postsResponse: {
      data: {
        posts: [
          {
            user_id: 7,
            round_num: 1,
            content: 'I shared the invitation but I do not know whether my partner actually joined the space.',
          },
        ],
      },
    },
    commentsResponse: { data: { comments: [] } },
    interviewsResponse: { data: { result: { results: {} } } },
    reportResponse: { data: { summary: 'Empty.', sections: [] } },
  });
  assert.deepEqual(bundle.observations, []);
});
