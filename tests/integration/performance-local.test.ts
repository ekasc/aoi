import { expect, it } from 'vitest';

import { startBoundaryServer, TOKEN_A } from './helpers/http-harness';

it('serves 200 authenticated reads with 20 concurrent local clients', async () => {
  const server = await startBoundaryServer();
  const paths = ['/v1/spaces/current', '/v1/spaces/current/moments', '/v1/spaces/current/collections', '/v1/spaces/current/letters'];
  const timings: number[] = [];
  const failures: { path: string; status: number }[] = [];
  const start = performance.now();
  try {
    for (let batch = 0; batch < 10; batch++) {
      await Promise.all(Array.from({ length: 20 }, async (_, index) => {
        const path = paths[index % paths.length];
        const before = performance.now();
        const response = await fetch(`${server.baseUrl}${path}`, {
          headers: { Authorization: `Bearer ${TOKEN_A}` },
          signal: AbortSignal.timeout(5000),
        });
        await response.json();
        timings.push(performance.now() - before);
        if (response.status !== 200) failures.push({ path, status: response.status });
      }));
    }
    const sorted = timings.sort((a, b) => a - b);
    console.log(JSON.stringify({ benchmark: 'local-http-read-burst', requests: timings.length, concurrency: 20, totalMs: Math.round(performance.now() - start), p50Ms: Math.round(sorted[99]), p95Ms: Math.round(sorted[189]), maxMs: Math.round(sorted[199]), failures, environment: 'real Hono HTTP, in-memory SQLite D1 shim, seeded small dataset; not Cloudflare capacity' }));
    expect(failures).toEqual([]);
    expect(timings).toHaveLength(200);
  } finally {
    await server.close();
  }
}, 20000);
