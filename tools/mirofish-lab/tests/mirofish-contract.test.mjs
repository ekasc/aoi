import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { MiroFishClient } from '../src/mirofish-client.mjs';
import { runLiveSimulation } from '../src/simulation-runner.mjs';
import { loadPersonas } from '../src/pipeline.mjs';

/**
 * Contract test for the live adapter. This is a local stub of the documented
 * MiroFish HTTP API, not a MiroFish simulation. It proves the client and
 * runner speak the right shapes and that every step is wired. It does not
 * prove that a real MiroFish deployment will behave the same way.
 */

function json(response, body, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function startStub() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    const url = request.url ?? '/';

    if (url === '/health') return json(response, { status: 'ok' });
    if (url === '/api/graph/ontology/generate') {
      return json(response, { success: true, data: { project_id: 'proj-1' } });
    }
    if (url === '/api/graph/build') return json(response, { success: true, data: { task_id: 'build-1' } });
    if (url === '/api/graph/task/build-1') return json(response, { success: true, data: { status: 'completed' } });
    if (url === '/api/graph/project/proj-1') return json(response, { success: true, data: { graph_id: 'graph-1' } });
    if (url === '/api/simulation/create') return json(response, { success: true, data: { simulation_id: 'sim-1' } });
    if (url === '/api/simulation/prepare') return json(response, { success: true, data: { task_id: 'prep-1' } });
    if (url === '/api/simulation/prepare/status') return json(response, { success: true, data: { status: 'ready' } });
    if (url === '/api/simulation/start') return json(response, { success: true, data: { runner_status: 'running' } });
    if (url.startsWith('/api/simulation/sim-1/run-status')) {
      return json(response, { success: true, data: { runner_status: 'completed', current_round: 2 } });
    }
    if (url === '/api/simulation/sim-1/profiles') {
      return json(response, {
        success: true,
        data: {
          profiles: [
            { user_id: 0, name: 'Alice Moreau', username: 'alice_moreau', bio: 'Fictional designer' },
          ],
        },
      });
    }
    if (url.startsWith('/api/simulation/sim-1/actions')) {
      return json(response, { success: true, data: { actions: [] } });
    }
    if (url.startsWith('/api/simulation/sim-1/posts')) {
      return json(response, {
        success: true,
        data: {
          posts: [
            {
              user_id: 0,
              round_num: 1,
              content:
                'I shared the invitation with Bob and assumed we were connected. The app never told me whether he had joined.',
            },
          ],
        },
      });
    }
    if (url.startsWith('/api/simulation/sim-1/comments')) {
      return json(response, { success: true, data: { comments: [] } });
    }
    if (url === '/api/simulation/interview/batch') {
      return json(response, {
        success: true,
        data: {
          result: {
            results: {
              reddit_0: {
                agent_id: 0,
                response: 'I expected the sky photo to appear in Memories.',
              },
            },
          },
        },
      });
    }
    if (url === '/api/report/generate') return json(response, { success: true, data: { task_id: 'report-1' } });
    if (url === '/api/report/generate/status') {
      return json(response, { success: true, data: { status: 'completed' } });
    }
    if (url === '/api/report/by-simulation/sim-1') {
      return json(response, {
        success: true,
        data: { summary: 'Stub report.', sections: [{ title: 'Invitations', content: 'Sharing is not joining.' }] },
      });
    }
    if (url === '/api/simulation/close-env') return json(response, { success: true, data: {} });
    return json(response, { success: false, error: `no stub route for ${url}` }, 404);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('the live adapter walks the documented MiroFish API end to end against a local stub', async () => {
  const stub = await startStub();
  try {
    const personas = loadPersonas();
    const client = new MiroFishClient({ baseUrl: stub.baseUrl, timeoutMs: 5000 });
    const result = await runLiveSimulation({
      config: {
        mirofish: {
          baseUrl: stub.baseUrl,
          requestTimeoutMs: 5000,
          pollIntervalMs: 10,
          startupTimeoutMs: 5000,
        },
        simulation: {
          projectName: 'Stub lab',
          model: 'stub-model',
          seedVersion: 'seeds-v1',
          enableTwitter: false,
          enableReddit: true,
          interviewAgents: 1,
        },
      },
      personas,
      rounds: 2,
      client,
    });

    assert.equal(result.bundle.mode, 'live');
    assert.equal(result.bundle.live, true);
    assert.ok(result.bundle.observations.length >= 1);
    assert.equal(result.bundle.observations[0].persona_id, 'p-alice');
    assert.ok(result.bundle.observations.some((observation) => observation.source === 'interview'));
    assert.match(result.bundle.report.summary, /stub report/i);
    assert.ok(stub.requests.includes('POST /api/graph/ontology/generate'));
    assert.ok(stub.requests.includes('POST /api/simulation/start'));
    assert.ok(stub.requests.includes('POST /api/report/generate'));
  } finally {
    await stub.close();
  }
});
