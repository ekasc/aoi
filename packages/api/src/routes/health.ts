import { Hono } from 'hono';

const health = new Hono();

health.get('/healthz', (c) => c.json({ status: 'ok' }));

health.get('/readyz', (c) => {
  // Could add DB ping check here
  return c.json({ status: 'ok' });
});

export { health };
