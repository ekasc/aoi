import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { createProxyServer } from '../src/opencode-proxy.mjs';

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

test('OpenCode Go proxy adds x-opencode-session and a client User-Agent', async () => {
  const seen = [];
  const upstream = createServer((request, response) => {
    seen.push({ url: request.url, headers: request.headers });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  const upstreamPort = await listen(upstream);
  const proxy = createProxyServer({
    upstream: `http://127.0.0.1:${upstreamPort}/v1`,
    sessionId: 'test-session-id',
    userAgent: 'aoi-mirofish-lab/test',
  });
  const proxyPort = await listen(proxy);
  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({ model: 'test' }),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), JSON.stringify({ ok: true }));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, '/v1/chat/completions');
    assert.equal(seen[0].headers['x-opencode-session'], 'test-session-id');
    assert.equal(seen[0].headers['user-agent'], 'aoi-mirofish-lab/test');
    assert.equal(seen[0].headers.authorization, 'Bearer test');

    const health = await fetch(`http://127.0.0.1:${proxyPort}/health`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.session, 'test-session-id');
  } finally {
    await new Promise((resolve) => proxy.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});
