import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = parseInt(process.env.PORT ?? '8080', 10);

console.log(`[aoi-api] starting on port ${port}`);
console.log(`[aoi-api] cors origin: ${process.env.CORS_ORIGIN ?? '*'}`);

serve({
  fetch: app.fetch,
  port,
});
