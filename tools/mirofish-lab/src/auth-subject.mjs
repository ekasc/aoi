import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

import { createApp } from '../../../packages/api/src/create-app.ts';
import { makeTestHarness } from '../../../packages/api/src/effects/test-harness.ts';

const root = resolve(import.meta.dirname, '../../..');
const sources = [
  'features/session/session-context.tsx', 'features/session/types.ts',
  'features/api-client.ts', 'features/request-deadline.ts',
  'features/auth/auth-api.ts', 'features/auth/oauth-client.ts',
  'features/space/space-context.tsx', 'features/space/space-snapshot.ts',
  'features/space/remote-space-repository.ts', 'features/push/push-api.ts',
  'packages/api/src/domains/auth.ts', 'packages/api/src/domains/spaces.ts',
  'packages/api/src/middleware/session.ts', 'packages/api/src/routes/session-auth.ts',
  'packages/api/src/auth/better-auth.ts',
  'tests/unit/session/session-signout.test.tsx', 'tests/unit/session/session-restore.test.tsx',
  'tests/unit/auth/api-client-tokens.test.ts', 'tests/unit/space/space-context-refresh.test.tsx',
  'tests/unit/push/push-api.test.ts',
  'packages/shared/src/auth.ts',
];
const checks = {
  session: ['tests/unit/session'],
  transport: ['tests/unit/auth/api-client-tokens.test.ts', 'tests/unit/auth/api-client-deadline.test.ts', 'tests/unit/auth/remote-auth-api.test.ts'],
  space: ['tests/unit/space'],
  push: ['tests/unit/push'],
  navigation: ['tests/unit/navigation/us-entry-tabs.test.tsx'],
  boundary: ['tests/integration/session-lifecycle-boundary.test.ts', 'packages/api/src/__tests__/routes/session-auth.test.ts', 'packages/api/src/__tests__/auth/auth-domains.test.ts'],
};
checks.security = [...new Set(Object.values(checks).flat())];
const sourceGroups = {
  'session-source': ['features/session/session-context.tsx', 'features/auth/auth-api.ts', 'features/request-deadline.ts', 'tests/unit/session/session-restore.test.tsx'],
  'isolation-source': ['features/api-client.ts', 'features/push/push-api.ts', 'features/space/space-context.tsx', 'features/session/session-context.tsx', 'features/auth/auth-api.ts', 'packages/api/src/domains/auth.ts', 'tests/unit/push/push-session-boundary.test.tsx'],
  'revocation-source': ['packages/api/src/domains/auth.ts', 'packages/api/src/routes/session-auth.ts', 'features/session/session-context.tsx', 'features/auth/auth-api.ts', 'features/push/push-api.ts', 'packages/shared/src/auth.ts'],
};
const paths = new Set([
  '/v1/auth/session', '/v1/auth/refresh', '/v1/auth/logout', '/v1/auth/sessions', '/v1/auth/account',
  '/v1/spaces/current', '/v1/spaces/leave', '/v1/spaces/join', '/v1/spaces/current/invite',
]);
const users = {
  maya: '00000000-0000-4000-8000-000000000001',
  june: '00000000-0000-4000-8000-000000000002',
  outsider: '00000000-0000-4000-8000-000000000003',
};
const actors = {
  'maya-phone': { user: 'maya', token: 'synthetic-maya-phone' },
  'maya-tablet': { user: 'maya', token: 'synthetic-maya-tablet' },
  'june-phone': { user: 'june', token: 'synthetic-june-phone' },
  outsider: { user: 'outsider', token: 'synthetic-outsider' },
  unknown: { user: null, token: 'never-issued' },
  anonymous: { user: null, token: null },
};
const spaceId = '00000000-0000-4000-8000-000000000010';
let harness;
let app;
let last = null;
let sequence = 0;

function reset() {
  harness?.d1.rawDb.close();
  harness = makeTestHarness();
  app = createApp(harness.layer);
  for (const [name, id] of Object.entries(users)) {
    harness.d1.runSync('insert into users (id,email,name,email_verified) values (?,?,?,1)', id, `${name}@swarm.invalid`, name);
  }
  for (const [name, actor] of Object.entries(actors)) {
    if (!actor.user) continue;
    harness.d1.runSync('insert into user_sessions (id,user_id,token,expires_at) values (?,?,?,?)', name, users[actor.user], actor.token, harness.clock.value() + 86400000);
    harness.d1.runSync('insert into push_tokens (id,user_id,expo_push_token) values (?,?,?)', name, users[actor.user], `ExponentPushToken[${name.replaceAll('-', '')}aaaaaaaaaaaaaaaaaaaa]`);
  }
  harness.d1.runSync('insert into spaces (id,name,created_by_user_id) values (?,?,?)', spaceId, 'Synthetic space', users.maya);
  harness.d1.runSync("insert into space_members (space_id,user_id,role,state) values (?,?,'you','active')", spaceId, users.maya);
  harness.d1.runSync("insert into space_members (space_id,user_id,role,state) values (?,?,'partner','active')", spaceId, users.june);
  last = null;
}

function state() {
  return {
    sessions: harness.d1.rawDb.prepare('select id,user_id,expires_at from user_sessions').all(),
    memberships: harness.d1.rawDb.prepare('select space_id,user_id,state from space_members').all(),
    push: harness.d1.rawDb.prepare('select user_id,count(*) as count from push_tokens group by user_id').all(),
    now: new Date(harness.clock.value()).toISOString(),
    last,
  };
}

function observe() {
  return {
    text: JSON.stringify({
      policy: 'Established sessions do not expire. Only explicit sign-out, global revocation, or account deletion removes access. Failures retain session/known space. Revocation never removes membership. Never recommend automatic expiry. All accounts below are synthetic.',
      limits: 'HTTP uses real Hono + D1 in memory. Native SessionProvider is exercised by real provider tests with mocked native storage/network. This cannot prove device keychain or OAuth provider behavior. No arbitrary code execution, file reads, shell commands, production data, or live accounts.',
      usage: 'inspect target=source path args={offset:1,limit:100}; request target=listed API path args={actor:"maya-phone",method:"GET",body:{}}; refresh body can use {refreshToken:"$session"} to present that actor credential; mint target=actor issues a new synthetic fixture session after explicit signout, NOT an OAuth test; tests target=check name; reset fixture before unrelated sequences; clock args={days:400}. Call inspect and tests, then attempt request sequences. Record only observed failures or source-backed hypotheses and distinguish them.',
      actors: Object.keys(actors), users, spaceId, state: state(),
    }),
    actions: [
      { name: 'inspect', needsTarget: true, needsArgs: false },
      { name: 'request', needsTarget: true, needsArgs: true },
      { name: 'tests', needsTarget: true },
      { name: 'scenario', needsTarget: true },
      { name: 'mint', needsTarget: true },
      { name: 'clock', needsTarget: false, needsArgs: true },
      { name: 'reset', needsTarget: false },
      { name: 'state', needsTarget: false },
    ],
    targets: [
      ...sources.map((id) => ({ id, label: 'Current source, read-only' })),
      ...Object.keys(sourceGroups).map((id) => ({ id, label: 'Read these related source files in one action' })),
      ...Object.keys(checks).map((id) => ({ id, label: `Run ${id} regression tests; exit status is the oracle` })),
      ...['old-expiry', 'global-revocation', 'single-signout', 'logout-lifecycle', 'access-isolation'].map((id) => ({ id, label: 'Atomic scripted HTTP scenario, with individual real responses and assertions' })),
      ...[...paths].map((id) => ({ id, label: 'Isolated API endpoint' })),
      ...Object.keys(actors).map((id) => ({ id, label: 'Synthetic actor for mint' })),
    ],
  };
}

async function act({ action, target, args = {} }) {
  if (action === 'scenario' && target === 'logout-lifecycle') {
    const global = JSON.parse(await act({ action, target: 'global-revocation' }));
    const device = JSON.parse(await act({ action, target: 'single-signout' }));
    return JSON.stringify({ scenario: target, passed: true, global, device });
  }
  if (action === 'inspect' && Object.hasOwn(sourceGroups, target)) {
    return sourceGroups[target].map((file) => `${file}\n${readFileSync(resolve(root, file), 'utf8').split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n')}`).join('\n\n');
  }
  if (action === 'inspect' && sources.includes(target)) {
    const lines = readFileSync(resolve(root, target), 'utf8').split('\n');
    const start = Math.max(0, Math.min(lines.length, Number(args?.offset ?? 1) - 1));
    const count = Math.max(1, Math.min(150, Number(args?.limit ?? 120)));
    return lines.slice(start, start + count).map((line, i) => `${start + i + 1}: ${line}`).join('\n');
  }
  if (action === 'tests' && Object.hasOwn(checks, target)) {
    const run = spawnSync('pnpm', ['exec', 'vitest', 'run', '--maxWorkers', '1', ...checks[target]], {
      cwd: root, encoding: 'utf8', timeout: 90000, env: { ...process.env, EXPO_NO_DOTENV: '1' },
    });
    return JSON.stringify({ exitCode: run.status, error: run.error?.message, output: `${run.stdout ?? ''}\n${run.stderr ?? ''}`.slice(-18000) });
  }
  if (action === 'reset') { reset(); return JSON.stringify(state()); }
  if (action === 'state') return JSON.stringify(state());
  if (action === 'clock' && Number.isFinite(args?.days) && Math.abs(args.days) <= 10000) {
    harness.clock.advance(args.days * 86400000);
    return JSON.stringify(state());
  }
  if (action === 'mint' && Object.hasOwn(actors, target) && actors[target].user) {
    const actor = actors[target];
    const id = `mint-${++sequence}`;
    actor.token = `synthetic-${target}-${id}`;
    harness.d1.runSync('insert into user_sessions (id,user_id,token,expires_at) values (?,?,?,?)', id, users[actor.user], actor.token, harness.clock.value() + 86400000);
    return JSON.stringify(state());
  }
  if (action === 'scenario' && ['old-expiry', 'global-revocation', 'single-signout', 'access-isolation'].includes(target)) {
    reset();
    const steps = [];
    const request = async (actor, method, path, body = {}) => {
      const result = JSON.parse(await act({ action: 'request', target: path, args: { actor, method, body } }));
      steps.push(result);
      return result;
    };
    if (target === 'old-expiry') {
      harness.clock.advance(400 * 86400000);
      assert.equal((await request('maya-phone', 'GET', '/v1/auth/session')).status, 200);
      assert.equal((await request('maya-phone', 'POST', '/v1/auth/refresh', { refreshToken: '$session' })).status, 200);
      assert.equal((await request('maya-phone', 'GET', '/v1/spaces/current')).body.space.id, spaceId);
    } else if (target === 'global-revocation') {
      const oldToken = actors['maya-phone'].token;
      assert.equal((await request('maya-phone', 'DELETE', '/v1/auth/sessions')).status, 200);
      assert.equal((await request('maya-tablet', 'GET', '/v1/auth/session')).status, 401);
      assert.equal((await request('june-phone', 'GET', '/v1/auth/session')).status, 200);
      assert.equal((await request('maya-phone', 'POST', '/v1/auth/refresh', { refreshToken: oldToken })).status, 401);
      assert.equal(state().memberships.every((member) => member.state === 'active'), true);
      assert.equal(state().push.some((entry) => entry.user_id === users.maya), false);
      await act({ action: 'mint', target: 'maya-phone' });
      assert.equal((await request('maya-phone', 'GET', '/v1/spaces/current')).body.space.id, spaceId);
      assert.equal((await request('maya-phone', 'POST', '/v1/auth/refresh', { refreshToken: oldToken })).status, 401);
    } else if (target === 'single-signout') {
      const device = harness.d1.rawDb.prepare('select expo_push_token from push_tokens where id = ?').get('maya-phone');
      assert.equal((await request('maya-phone', 'POST', '/v1/auth/logout', { expoPushToken: device.expo_push_token })).status, 200);
      assert.equal((await request('maya-phone', 'GET', '/v1/auth/session')).status, 401);
      assert.equal((await request('maya-tablet', 'GET', '/v1/auth/session')).status, 200);
      assert.equal((await request('june-phone', 'GET', '/v1/auth/session')).status, 200);
      assert.equal(harness.d1.rawDb.prepare('select id from push_tokens where id = ?').get('maya-phone'), undefined);
      assert.ok(harness.d1.rawDb.prepare('select id from push_tokens where id = ?').get('maya-tablet'));
      assert.equal(state().memberships.every((member) => member.state === 'active'), true);
    } else {
      assert.equal((await request('anonymous', 'GET', '/v1/auth/session')).status, 401);
      assert.equal((await request('unknown', 'GET', '/v1/auth/session')).status, 401);
      assert.equal((await request('outsider', 'GET', '/v1/spaces/current')).body.space, null);
      assert.equal((await request('maya-phone', 'POST', '/v1/spaces/leave')).status, 200);
      assert.equal((await request('maya-phone', 'GET', '/v1/spaces/current')).body.space, null);
      assert.equal((await request('june-phone', 'GET', '/v1/spaces/current')).body.space.id, spaceId);
    }
    return JSON.stringify({ scenario: target, passed: true, steps, state: state(), limits: 'Synthetic session mint bypasses OAuth. Real provider and device behavior are not tested.' });
  }
  if (action === 'request' && paths.has(target) && Object.hasOwn(actors, args?.actor) && ['GET', 'POST', 'PATCH', 'DELETE'].includes(args?.method)) {
    const actor = actors[args.actor];
    const headers = { 'Content-Type': 'application/json', ...(actor.token ? { Authorization: `Bearer ${actor.token}` } : {}) };
    const body = { ...(args.body ?? {}) };
    if (body.refreshToken === '$session') body.refreshToken = actor.token;
    const response = await app.request(target, { method: args.method, headers, ...(args.method !== 'GET' ? { body: JSON.stringify(body) } : {}) });
    last = { actor: args.actor, method: args.method, path: target, status: response.status, body: await response.json() };
    return JSON.stringify(last);
  }
  throw new Error('Action or target is outside the advertised fixture capabilities');
}

reset();
try {
  for await (const line of createInterface({ input: process.stdin })) {
    let message;
    try {
      message = JSON.parse(line);
      if (message.op === 'close') {
        process.stdout.write(`${JSON.stringify({ id: message.id, ok: true })}\n`);
        break;
      }
      const result = message.op === 'observe'
        ? { observation: observe() }
        : { result: { ok: true, text: await act(message) } };
      process.stdout.write(`${JSON.stringify({ id: message.id, ok: true, ...result })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ id: message?.id, ok: false, error: error.message })}\n`);
    }
  }
} finally {
  harness.d1.rawDb.close();
}
