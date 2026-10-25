import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

/**
 * Loopback proxy for OpenCode Go.
 *
 * OpenCode Go requires a stable per-conversation `x-opencode-session` header
 * and a real client User-Agent. MiroFish and Camel do not expose an easy way
 * to add both, so point their OpenAI base URL at this proxy:
 *
 *   LLM_BASE_URL=http://127.0.0.1:5051/v1
 *
 * The proxy forwards /v1/* to the OpenAI-compatible Go endpoint and adds the
 * required headers. It binds to 127.0.0.1 only.
 */

export const OPENCODE_GO_OPENAI_BASE = 'https://opencode.ai/inference/go/openai/v1';

export function createProxyServer({
  upstream = OPENCODE_GO_OPENAI_BASE,
  sessionId = process.env.OPENCODE_SESSION_ID ?? randomUUID(),
  userAgent = process.env.LAB_USER_AGENT ?? 'aoi-mirofish-lab/1.0',
} = {}) {
  const upstreamBase = upstream.replace(/\/+$/, '');
  return createServer(async (request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', upstream: upstreamBase, session: sessionId }));
      return;
    }
    if (!request.url?.startsWith('/v1/')) {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Use /v1/*' } }));
      return;
    }

    const target = `${upstreamBase}${request.url.slice('/v1'.length)}`;
    const headers = { ...request.headers };
    delete headers.host;
    delete headers['content-length'];
    headers['x-opencode-session'] = request.headers['x-opencode-session'] ?? sessionId;
    headers['user-agent'] = userAgent;

    try {
      const upstreamResponse = await fetch(target, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request,
        duplex: 'half',
      });
      const responseHeaders = {};
      for (const [name, value] of upstreamResponse.headers.entries()) {
        if (name === 'content-encoding' || name === 'transfer-encoding') continue;
        responseHeaders[name] = value;
      }
      response.writeHead(upstreamResponse.status, responseHeaders);
      if (upstreamResponse.body) {
        for await (const chunk of upstreamResponse.body) response.write(chunk);
      }
      response.end();
    } catch (error) {
      response.writeHead(502, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          error: {
            message: `OpenCode Go proxy failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        })
      );
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.OPENCODE_PROXY_PORT ?? 5051);
  const server = createProxyServer();
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(
      `OpenCode Go proxy: http://127.0.0.1:${port}/v1 (session ${process.env.OPENCODE_SESSION_ID ?? 'random at startup'})\n`
    );
  });
}
