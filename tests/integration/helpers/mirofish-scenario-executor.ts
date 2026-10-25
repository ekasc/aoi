import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { createApp } from '../../../packages/api/src/create-app';
import { makeTestHarness, type TestHarness } from '../../../packages/api/src/effects/test-harness';

/**
 * Data-driven executor for MiroFish lab scenarios.
 *
 * Only the operations listed here can run. A scenario is JSON data, never
 * generated code: unsupported operations fail the test instead of being
 * interpreted. This keeps LLM/simulation output away from arbitrary execution.
 */

const USER_A = '00000000-0000-4000-8000-0000000000a1';
const USER_B = '00000000-0000-4000-8000-0000000000b2';
const USER_C = '00000000-0000-4000-8000-0000000000c3';
const TOKEN_A = 'mirofish-token-a';
const TOKEN_B = 'mirofish-token-b';
const TOKEN_C = 'mirofish-token-c';
const NOW = Date.parse('2026-10-22T00:00:00.000Z');
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface ScenarioAction {
  op: string;
  note?: string;
  actor?: 'A' | 'B' | 'C';
}

export interface ScenarioAssertion {
  kind: string;
  viewer?: 'A' | 'B' | 'C';
  value?: string | number | boolean;
}

export interface ExecutableScenario {
  id: string;
  title: string;
  actors: string[];
  actions: ScenarioAction[];
  execution: {
    target: 'integration' | 'unit';
    test_path: string;
    assertions: ScenarioAssertion[];
  };
}

interface ExecutorContext {
  app: ReturnType<typeof createApp>;
  harness: TestHarness;
  inviteByActor: Partial<Record<'A' | 'B' | 'C', string>>;
  spaceByActor: Partial<Record<'A' | 'B' | 'C', string>>;
  momentId: string | null;
  momentUpdatedAt: string | null;
  momentOriginalUpdatedAt: string | null;
  clientId: string | null;
  lastResponse: { status: number; body: unknown } | null;
  partnerEverJoined: boolean;
  partnerActive: boolean;
  editCount: number;
}

export function loadExecutableScenarios(target: 'integration' | 'unit'): ExecutableScenario[] {
  const root = join(process.cwd(), 'tools', 'mirofish-lab', 'scenarios');
  const seen = new Set<string>();
  return readdirSync(root)
    .filter((name) => /^AOI-SIM-\d{3}\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(root, name), 'utf8')) as ExecutableScenario)
    .filter((scenario) => scenario.execution?.target === target)
    .sort((a, b) => a.id.localeCompare(b.id))
    // Per-couple variants of one template run against the same fixed A/B
    // harness. Execute one representative per template instead of pretending
    // 35 copies are 35 independent tests.
    .filter((scenario) => {
      if (seen.has(scenario.title)) return false;
      seen.add(scenario.title);
      return true;
    });
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function json(token: string, body: unknown, method = 'POST') {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify(body),
  };
}

function insertUser(harness: TestHarness, id: string, email: string, name: string): void {
  harness.d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    NOW,
    NOW
  );
}

function insertSession(harness: TestHarness, id: string, userId: string, token: string): void {
  harness.d1.runSync(
    'insert into user_sessions (id, user_id, token, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
    id,
    userId,
    token,
    NOW + YEAR_MS,
    NOW,
    NOW
  );
}

export function startScenario(): ExecutorContext {
  const harness = makeTestHarness();
  insertUser(harness, USER_A, 'alice@example.com', 'Alice');
  insertUser(harness, USER_B, 'bob@example.com', 'Bob');
  insertUser(harness, USER_C, 'casey@example.com', 'Casey');
  insertSession(harness, 'mf-sess-a', USER_A, TOKEN_A);
  insertSession(harness, 'mf-sess-b', USER_B, TOKEN_B);
  insertSession(harness, 'mf-sess-c', USER_C, TOKEN_C);
  return {
    app: createApp(harness.layer),
    harness,
    inviteByActor: {},
    spaceByActor: {},
    momentId: null,
    momentUpdatedAt: null,
    momentOriginalUpdatedAt: null,
    clientId: null,
    lastResponse: null,
    partnerEverJoined: false,
    partnerActive: false,
    editCount: 0,
  };
}

function tokenFor(viewer: 'A' | 'B' | 'C' | undefined): string {
  if (viewer === 'B') return TOKEN_B;
  if (viewer === 'C') return TOKEN_C;
  return TOKEN_A;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function currentSpace(ctx: ExecutorContext, token: string): Promise<{ id: string; partnerJoined: boolean } | null> {
  const response = await ctx.app.request('/v1/spaces/current', { headers: auth(token) });
  const body = (await readJson(response)) as { space?: { id: string; partnerJoined: boolean } | null } | null;
  return body?.space ?? null;
}

async function listMoments(ctx: ExecutorContext, token: string): Promise<{ id: string; authorRole: string; authorName: string }[]> {
  const response = await ctx.app.request('/v1/spaces/current/moments', { headers: auth(token) });
  const body = (await readJson(response)) as { moments?: { id: string; authorRole: string; authorName: string }[] } | null;
  return body?.moments ?? [];
}

export async function runAction(ctx: ExecutorContext, action: ScenarioAction, scenarioId: string): Promise<void> {
  switch (action.op) {
    case 'create_space': {
      const actor = action.actor ?? 'A';
      const response = await ctx.app.request(
        '/v1/spaces',
        json(tokenFor(actor), {
          name: `${actor}'s space`,
          partnerName: actor === 'A' ? 'Bob' : 'Partner',
          relationshipStartDate: '2026-01-01',
        })
      );
      const body = (await readJson(response)) as { space?: { id: string }; inviteCode?: string } | null;
      ctx.lastResponse = { status: response.status, body };
      if (response.status !== 201) throw new Error(`create_space failed: ${response.status} ${JSON.stringify(body)}`);
      ctx.spaceByActor[actor] = body?.space?.id;
      ctx.inviteByActor[actor] = body?.inviteCode;
      return;
    }
    case 'invite_partner': {
      const actor = action.actor ?? 'A';
      if (!ctx.inviteByActor[actor] || (ctx.partnerEverJoined && !ctx.partnerActive)) {
        const response = await ctx.app.request('/v1/spaces/current/invite', {
          method: 'POST',
          headers: auth(tokenFor(actor)),
        });
        const body = (await readJson(response)) as { inviteCode?: string } | null;
        ctx.lastResponse = { status: response.status, body };
        if (response.status !== 201) throw new Error(`invite_partner failed: ${response.status}`);
        ctx.inviteByActor[actor] = body?.inviteCode;
      }
      return;
    }
    case 'join_space': {
      const actor = action.actor ?? 'B';
      const inviteCode = ctx.inviteByActor.A;
      const response = await ctx.app.request(
        '/v1/spaces/join',
        json(tokenFor(actor), { inviteCode })
      );
      const body = await readJson(response);
      ctx.lastResponse = { status: response.status, body };
      if (response.status === 200) {
        ctx.partnerEverJoined = true;
        ctx.partnerActive = true;
      }
      return;
    }
    case 'leave_space': {
      const actor = action.actor ?? 'B';
      const response = await ctx.app.request('/v1/spaces/leave', {
        method: 'POST',
        headers: auth(tokenFor(actor)),
      });
      const body = await readJson(response);
      ctx.lastResponse = { status: response.status, body };
      if (response.status === 200) ctx.partnerActive = false;
      return;
    }
    case 'create_memory': {
      ctx.clientId = `mf-${scenarioId}-1`;
      const response = await ctx.app.request(
        '/v1/spaces/current/moments',
        json(TOKEN_A, {
          type: 'note',
          title: 'A note before pairing',
          body: 'Synthetic lab content.',
          occurredAt: new Date(NOW).toISOString(),
          clientId: ctx.clientId,
        })
      );
      const body = (await readJson(response)) as { id?: string; updatedAt?: string } | null;
      ctx.lastResponse = { status: response.status, body };
      if (response.status !== 201) throw new Error(`create_memory failed: ${response.status} ${JSON.stringify(body)}`);
      ctx.momentId = body?.id ?? null;
      ctx.momentUpdatedAt = body?.updatedAt ?? null;
      ctx.momentOriginalUpdatedAt = body?.updatedAt ?? null;
      return;
    }
    case 'edit_memory': {
      if (!ctx.momentId || !ctx.momentUpdatedAt) throw new Error('edit_memory requires create_memory first');
      const first = ctx.editCount === 0;
      const actor = action.actor ?? 'A';
      const token = tokenFor(actor);
      const staleUpdatedAt = first ? ctx.momentUpdatedAt : ctx.momentOriginalUpdatedAt;
      const response = await ctx.app.request(
        `/v1/moments/${ctx.momentId}`,
        json(token, { title: first ? 'Edited by Bob' : 'Stale edit by Alice', expectedUpdatedAt: staleUpdatedAt }, 'PATCH')
      );
      const body = await readJson(response);
      ctx.lastResponse = { status: response.status, body };
      if (first && response.status === 200) {
        const updated = body as { updatedAt?: string } | null;
        ctx.momentUpdatedAt = updated?.updatedAt ?? ctx.momentUpdatedAt;
      }
      ctx.editCount += 1;
      return;
    }
    case 'delete_memory': {
      if (!ctx.momentId) throw new Error('delete_memory requires create_memory first');
      const response = await ctx.app.request(
        `/v1/moments/${ctx.momentId}`,
        json(TOKEN_A, { expectedUpdatedAt: ctx.momentUpdatedAt }, 'DELETE')
      );
      const body = await readJson(response);
      ctx.lastResponse = { status: response.status, body };
      return;
    }
    case 'refresh_space': {
      const space = await currentSpace(ctx, TOKEN_A);
      if (space) {
        ctx.spaceByActor.A = space.id;
        ctx.partnerActive = space.partnerJoined;
      }
      return;
    }
    case 'open_memories':
    case 'open_us':
    case 'open_plans':
    case 'open_collection':
    case 'add_sky_photo':
    case 'edit_relationship':
      // UI navigation/selection has no server effect in the integration
      // harness. The action is recorded in the scenario but not executed.
      return;
    case 'change_subscription': {
      const response = await ctx.app.request('/v1/billing/revenuecat/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-revenuecat-webhook-secret',
        },
        body: JSON.stringify({
          api_version: '1.0',
          event: {
            id: `mf-${scenarioId}`,
            type: 'INITIAL_PURCHASE',
            app_user_id: USER_A,
            event_timestamp_ms: NOW,
            entitlement_id: 'plus',
            entitlement_ids: ['plus'],
            product_id: 'aoi_plus_monthly',
            expiration_at_ms: NOW + YEAR_MS,
            store: 'app_store',
            environment: 'PRODUCTION',
          },
        }),
      });
      ctx.lastResponse = { status: response.status, body: await readJson(response) };
      return;
    }
    default:
      throw new Error(`Unsupported integration action: ${action.op}`);
  }
}

export async function runScenario(scenario: ExecutableScenario): Promise<void> {
  if (scenario.execution.target !== 'integration') {
    throw new Error(`${scenario.id} is not an integration scenario`);
  }
  const ctx = startScenario();
  for (const action of scenario.actions) {
    await runAction(ctx, action, scenario.id);
  }
  for (const assertion of scenario.execution.assertions) {
    await assertScenario(ctx, assertion);
  }
}

async function assertScenario(ctx: ExecutorContext, assertion: ScenarioAssertion): Promise<void> {
  const viewer = assertion.viewer;
  switch (assertion.kind) {
    case 'space.memberCount': {
      const space = await currentSpace(ctx, tokenFor(viewer));
      if (!space) throw new Error('space.memberCount: no active space');
      const row = ctx.harness.d1.rawDb
        .prepare("select count(*) as n from space_members where space_id = ? and state = 'active'")
        .get(space.id) as { n: number };
      if (row.n !== assertion.value) throw new Error(`space.memberCount: expected ${assertion.value}, got ${row.n}`);
      return;
    }
    case 'space.partnerJoined': {
      const space = await currentSpace(ctx, tokenFor(viewer));
      if (!space) throw new Error('space.partnerJoined: no active space');
      if (space.partnerJoined !== assertion.value) {
        throw new Error(`space.partnerJoined: expected ${assertion.value}, got ${space.partnerJoined}`);
      }
      return;
    }
    case 'moment.count': {
      const moments = await listMoments(ctx, tokenFor(viewer));
      if (moments.length !== assertion.value) {
        throw new Error(`moment.count: expected ${assertion.value}, got ${moments.length}`);
      }
      return;
    }
    case 'moment.authorRole': {
      const moments = await listMoments(ctx, tokenFor(viewer));
      if (!moments[0]) throw new Error('moment.authorRole: no moment');
      if (moments[0].authorRole !== assertion.value) {
        throw new Error(`moment.authorRole: expected ${assertion.value}, got ${moments[0].authorRole}`);
      }
      return;
    }
    case 'moment.authorName': {
      const moments = await listMoments(ctx, tokenFor(viewer));
      if (!moments[0]) throw new Error('moment.authorName: no moment');
      if (moments[0].authorName !== assertion.value) {
        throw new Error(`moment.authorName: expected ${assertion.value}, got ${moments[0].authorName}`);
      }
      return;
    }
    case 'response.status': {
      if (ctx.lastResponse?.status !== assertion.value) {
        throw new Error(`response.status: expected ${assertion.value}, got ${ctx.lastResponse?.status}`);
      }
      return;
    }
    case 'response.error.code': {
      const body = ctx.lastResponse?.body as { error?: { code?: string } } | null;
      if (body?.error?.code !== assertion.value) {
        throw new Error(`response.error.code: expected ${assertion.value}, got ${body?.error?.code}`);
      }
      return;
    }
    case 'plus.isPlus':
    case 'plus.mediaLimitBytes': {
      const response = await ctx.app.request('/v1/spaces/current/plus', { headers: auth(tokenFor(viewer)) });
      const body = (await readJson(response)) as { isPlus?: boolean; mediaLimitBytes?: number } | null;
      const key = assertion.kind === 'plus.isPlus' ? 'isPlus' : 'mediaLimitBytes';
      if (body?.[key] !== assertion.value) {
        throw new Error(`${assertion.kind}: expected ${assertion.value}, got ${String(body?.[key])}`);
      }
      return;
    }
    default:
      throw new Error(`Unsupported assertion: ${assertion.kind}`);
  }
}
