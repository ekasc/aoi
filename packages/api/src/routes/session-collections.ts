import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  collectionItemListResponseSchema,
  collectionItemSchema,
  collectionListResponseSchema,
  collectionSchema,
  createCollectionItemRequestSchema,
  createCollectionItemResponseSchema,
  createCollectionRequestSchema,
  createCollectionResponseSchema,
  updateCollectionItemRequestSchema,
  updateCollectionRequestSchema,
} from '@aoi/shared';

import type { RunProgram } from '../create-app';
import { makeAuthMiddleware } from '../middleware/session';
import { makeRateLimitMiddleware } from '../middleware/session-rate-limit';
import {
  createCollectionItemProgram,
  createCollectionProgram,
  deleteCollectionItemProgram,
  deleteCollectionProgram,
  listCollectionItemsProgram,
  listCollectionsProgram,
  updateCollectionItemProgram,
  updateCollectionProgram,
} from '../domains/collections';

/**
 * Collections routes (worker) — thin transport over the Effect collections
 * programs. Membership gating and soft-delete semantics live in the domain
 * layer.
 *
 * NOTE: the legacy Node/Postgres app has no collections route set — this is
 * the Cloudflare worker's route set.
 */

export function collectionsRouter(run: RunProgram): Hono {
  const router = new Hono();
  const requireAuth = makeAuthMiddleware(run);
  const rateLimitGeneral = makeRateLimitMiddleware(run, 'GENERAL');
  const idParamSchema = z.object({ id: z.string().uuid() });

  // ── List shelves for the active space ─────────────────────────────────
  router.get(
    '/v1/spaces/current/collections',
    requireAuth,
    rateLimitGeneral,
    async (c) => {
      const result = await run(listCollectionsProgram(c.var.userId));
      return c.json(collectionListResponseSchema.parse({ collections: result }));
    }
  );

  // ── Create shelf ──────────────────────────────────────────────────────
  router.post(
    '/v1/spaces/current/collections',
    requireAuth,
    rateLimitGeneral,
    zValidator('json', createCollectionRequestSchema),
    async (c) => {
      const result = await run(
        createCollectionProgram(c.var.userId, c.req.valid('json'))
      );
      return c.json(createCollectionResponseSchema.parse({ collection: result }), 201);
    }
  );

  // ── Update shelf ──────────────────────────────────────────────────────
  router.patch(
    '/v1/collections/:id',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', idParamSchema),
    zValidator('json', updateCollectionRequestSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(
        updateCollectionProgram(c.var.userId, id, c.req.valid('json'))
      );
      return c.json({ collection: collectionSchema.parse(result) });
    }
  );

  // ── Delete shelf (soft; its items too) ────────────────────────────────
  router.delete(
    '/v1/collections/:id',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', idParamSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(deleteCollectionProgram(c.var.userId, id));
      return c.json(result);
    }
  );

  // ── List items in a shelf ─────────────────────────────────────────────
  router.get(
    '/v1/collections/:id/items',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', idParamSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(listCollectionItemsProgram(c.var.userId, id));
      return c.json(collectionItemListResponseSchema.parse({ items: result }));
    }
  );

  // ── Create item in a shelf ────────────────────────────────────────────
  router.post(
    '/v1/collections/:id/items',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', idParamSchema),
    zValidator('json', createCollectionItemRequestSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(
        createCollectionItemProgram(c.var.userId, id, c.req.valid('json'))
      );
      return c.json(createCollectionItemResponseSchema.parse({ item: result }), 201);
    }
  );

  // ── Update item ───────────────────────────────────────────────────────
  router.patch(
    '/v1/collection-items/:id',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', idParamSchema),
    zValidator('json', updateCollectionItemRequestSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(
        updateCollectionItemProgram(c.var.userId, id, c.req.valid('json'))
      );
      return c.json({ item: collectionItemSchema.parse(result) });
    }
  );

  // ── Delete item (soft) ────────────────────────────────────────────────
  router.delete(
    '/v1/collection-items/:id',
    requireAuth,
    rateLimitGeneral,
    zValidator('param', idParamSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const result = await run(deleteCollectionItemProgram(c.var.userId, id));
      return c.json(result);
    }
  );

  return router;
}
