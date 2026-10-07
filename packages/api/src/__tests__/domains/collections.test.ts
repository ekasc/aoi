import { describe, expect, it } from 'vitest';
import { Effect, Exit } from 'effect';

import { makeTestHarness, type ShimD1 } from '../../effects/test-harness';
import {
  createCollectionItemProgram,
  createCollectionProgram,
  deleteCollectionItemProgram,
  deleteCollectionProgram,
  listCollectionItemsProgram,
  listCollectionsProgram,
  updateCollectionItemProgram,
  updateCollectionProgram,
} from '../../domains/collections';
import { NotFoundError } from '../../domains/errors';

/**
 * Collections domain tests — pinned at the program level against the real D1
 * baseline (better-sqlite3 shim): shelves + items, item counts, canonical
 * position ordering, soft-delete (shelf hides and its items go too),
 * membership gating (non-member 404, no existence leak), and cross-space isolation.
 */

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';
const USER_D = '00000000-0000-4000-8000-000000000004';
const SPACE_1 = '00000000-0000-4000-8000-000000000010';
const SPACE_2 = '00000000-0000-4000-8000-000000000020';

function insertUser(d1: ShimD1, id: string, email: string, name: string): void {
  d1.runSync(
    'insert into users (id, email, name, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)',
    id,
    email,
    name,
    Date.parse('2026-01-01T00:00:00.000Z'),
    Date.parse('2026-01-01T00:00:00.000Z')
  );
}

function insertMember(d1: ShimD1, spaceId: string, userId: string, role: 'you' | 'partner'): void {
  d1.runSync(
    `insert into space_members (space_id, user_id, role, state, joined_at) values (?, ?, ?, 'active', ?)`,
    spaceId,
    userId,
    role,
    Date.parse('2026-01-01T00:00:00.000Z')
  );
}

function insertSpace(d1: ShimD1, id: string, creatorId: string): void {
  d1.runSync(
    `insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at)
     values (?, 'Our Space', 'Partner', '2026-01-01', ?, ?, ?)`,
    id,
    creatorId,
    Date.parse('2026-01-01T00:00:00.000Z'),
    Date.parse('2026-01-01T00:00:00.000Z')
  );
  insertMember(d1, id, creatorId, 'you');
}

function makeCtx() {
  const harness = makeTestHarness();
  return {
    harness,
    provide: <A, E, R>(program: Effect.Effect<A, E, R>) =>
      Effect.provide(program as Effect.Effect<A, E, never>, harness.layer as never) as Effect.Effect<A, E, never>,
  };
}

function run<A>(effect: Effect.Effect<A, unknown, never>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, unknown, never>);
}

async function failureOf<A>(effect: Effect.Effect<A, unknown, never>): Promise<unknown> {
  const exit = await Effect.runPromise(Effect.exit(effect as Effect.Effect<A, unknown, never>));
  if (Exit.isSuccess(exit)) {
    throw new Error('expected program to fail, but it succeeded');
  }
  const cause = exit.cause as { _tag: string; error?: unknown };
  if (cause._tag === 'Fail' && cause.error !== undefined) {
    return cause.error;
  }
  throw new Error(`unexpected failure cause: ${cause._tag}`);
}

/** A two-person space (A creator, B partner) + a solo space for C. */
function seedCouple(ctx: { harness: ReturnType<typeof makeTestHarness> }): void {
  insertUser(ctx.harness.d1, USER_A, 'a@example.com', 'Alice');
  insertUser(ctx.harness.d1, USER_B, 'b@example.com', 'Bob');
  insertUser(ctx.harness.d1, USER_C, 'c@example.com', 'Casey');
  insertUser(ctx.harness.d1, USER_D, 'd@example.com', 'Dana');
  insertSpace(ctx.harness.d1, SPACE_1, USER_A);
  insertMember(ctx.harness.d1, SPACE_1, USER_B, 'partner');
  insertSpace(ctx.harness.d1, SPACE_2, USER_C);
}

describe('collections domain — shelves', () => {
  it('creates shelves appended in position order with item counts', async () => {
    const ctx = makeCtx();
    seedCouple(ctx);

    const cafes = await run(ctx.provide(createCollectionProgram(USER_A, { name: 'Cafés we love', emoji: '☕' })));
    expect(cafes.position).toBe(0);
    expect(cafes.itemCount).toBe(0);
    expect(cafes.emoji).toBe('☕');

    const films = await run(ctx.provide(createCollectionProgram(USER_B, { name: 'Films to watch' })));
    expect(films.position).toBe(1);

    await run(ctx.provide(createCollectionItemProgram(USER_A, cafes.id, { title: 'Blue Bottle' })));
    await run(ctx.provide(createCollectionItemProgram(USER_B, cafes.id, { title: 'Sightglass' })));

    const list = await run(ctx.provide(listCollectionsProgram(USER_A)));
    expect(list.map((c) => c.name)).toEqual(['Cafés we love', 'Films to watch']);
    expect(list[0].itemCount).toBe(2);
    expect(list[1].itemCount).toBe(0);
  });

  it('returns an empty list without an active space, and only the caller\'s space otherwise', async () => {
    const ctx = makeCtx();
    seedCouple(ctx);
    await run(ctx.provide(createCollectionProgram(USER_A, { name: 'Ours' })));
    await run(ctx.provide(createCollectionProgram(USER_C, { name: 'Theirs' })));

    const a = await run(ctx.provide(listCollectionsProgram(USER_A)));
    expect(a.map((c) => c.name)).toEqual(['Ours']);

    const c = await run(ctx.provide(listCollectionsProgram(USER_C)));
    expect(c.map((c) => c.name)).toEqual(['Theirs']);

    const d = await run(ctx.provide(listCollectionsProgram(USER_D)));
    expect(d).toEqual([]);
  });

  it('patches name, emoji (including clearing it) and position', async () => {
    const ctx = makeCtx();
    seedCouple(ctx);
    const shelf = await run(ctx.provide(createCollectionProgram(USER_A, { name: 'Cafés', emoji: '☕' })));

    const updated = await run(
      ctx.provide(updateCollectionProgram(USER_B, shelf.id, { name: 'Coffee', emoji: null, position: 5 }))
    );
    expect(updated.name).toBe('Coffee');
    expect(updated.emoji).toBeUndefined();
    expect(updated.position).toBe(5);
  });

  it('soft-deletes a shelf and tombstones its items', async () => {
    const ctx = makeCtx();
    seedCouple(ctx);
    const shelf = await run(ctx.provide(createCollectionProgram(USER_A, { name: 'Cafés' })));
    await run(ctx.provide(createCollectionItemProgram(USER_A, shelf.id, { title: 'Blue Bottle' })));

    const deleted = await run(ctx.provide(deleteCollectionProgram(USER_B, shelf.id)));
    expect(deleted).toEqual({ ok: true });

    const list = await run(ctx.provide(listCollectionsProgram(USER_A)));
    expect(list).toEqual([]);

    const rows = ctx.harness.d1.rawDb
      .prepare('select count(*) as n from collection_items where deleted_at is null')
      .get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it('missing/deleted shelf → 404', async () => {
    const ctx = makeCtx();
    seedCouple(ctx);
    const fail = await failureOf(
      ctx.provide(updateCollectionProgram(USER_A, '00000000-0000-4000-8000-0000000000ff', { name: 'Nope' }))
    );
    expect(fail).toBeInstanceOf(NotFoundError);

    const shelf = await run(ctx.provide(createCollectionProgram(USER_A, { name: 'Cafés' })));
    await run(ctx.provide(deleteCollectionProgram(USER_A, shelf.id)));
    const afterDelete = await failureOf(ctx.provide(deleteCollectionProgram(USER_A, shelf.id)));
    expect(afterDelete).toBeInstanceOf(NotFoundError);
  });
});

describe('collections domain — items', () => {
  it('creates, lists (position then created_at), patches and soft-deletes items', async () => {
    const ctx = makeCtx();
    seedCouple(ctx);
    const shelf = await run(ctx.provide(createCollectionProgram(USER_A, { name: 'Cafés' })));

    const first = await run(
      ctx.provide(
        createCollectionItemProgram(USER_B, shelf.id, { title: 'Blue Bottle', note: 'The mint one', link: 'https://bluebottlecoffee.com' })
      )
    );
    const second = await run(ctx.provide(createCollectionItemProgram(USER_A, shelf.id, { title: 'Sightglass' })));
    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
    expect(first.collectionId).toBe(shelf.id);
    expect(first.link).toBe('https://bluebottlecoffee.com');

    const beforePatch = await run(ctx.provide(listCollectionItemsProgram(USER_A, shelf.id)));
    expect(beforePatch.map((i) => i.title)).toEqual(['Blue Bottle', 'Sightglass']);

    const patched = await run(
      ctx.provide(updateCollectionItemProgram(USER_B, second.id, { title: 'Sightglass Coffee', note: '', position: 0 }))
    );
    expect(patched.title).toBe('Sightglass Coffee');
    expect(patched.note).toBeUndefined();
    expect(patched.position).toBe(0);

    await run(ctx.provide(deleteCollectionItemProgram(USER_A, first.id)));
    const afterDelete = await run(ctx.provide(listCollectionItemsProgram(USER_A, shelf.id)));
    expect(afterDelete.map((i) => i.id)).toEqual([second.id]);

    const itemCount = (await run(ctx.provide(listCollectionsProgram(USER_A))))[0].itemCount;
    expect(itemCount).toBe(1);
  });

  it('400s creating a shelf without an active space', async () => {
    const ctx = makeCtx();
    insertUser(ctx.harness.d1, USER_D, 'd@example.com', 'Dana');
    const fail = await failureOf(ctx.provide(createCollectionProgram(USER_D, { name: 'Nowhere' })));
    expect(fail).toBeInstanceOf(Error);
    expect((fail as { _tag: string })._tag).toBe('BadRequestError');
  });
});

describe('collections domain — membership gating + isolation', () => {
  it('non-member gets 404, not 403, on an existing shelf and item', async () => {
    const ctx = makeCtx();
    seedCouple(ctx);
    const shelf = await run(ctx.provide(createCollectionProgram(USER_A, { name: 'Cafés' })));
    const item = await run(ctx.provide(createCollectionItemProgram(USER_A, shelf.id, { title: 'Blue Bottle' })));

    // USER_C is active in SPACE_2, not SPACE_1.
    const shelfFail = await failureOf(ctx.provide(updateCollectionProgram(USER_C, shelf.id, { name: 'Mine now' })));
    expect(shelfFail).toBeInstanceOf(NotFoundError);

    const itemFail = await failureOf(ctx.provide(updateCollectionItemProgram(USER_C, item.id, { title: 'Mine now' })));
    expect(itemFail).toBeInstanceOf(NotFoundError);

    const listItemsFail = await failureOf(ctx.provide(listCollectionItemsProgram(USER_C, shelf.id)));
    expect(listItemsFail).toBeInstanceOf(NotFoundError);

    const createItemFail = await failureOf(
      ctx.provide(createCollectionItemProgram(USER_C, shelf.id, { title: 'Sneaky' }))
    );
    expect(createItemFail).toBeInstanceOf(NotFoundError);

    const deleteShelfFail = await failureOf(ctx.provide(deleteCollectionProgram(USER_C, shelf.id)));
    expect(deleteShelfFail).toBeInstanceOf(NotFoundError);
  });

  it('cross-space isolation: same-space rows are never visible or mutable', async () => {
    const ctx = makeCtx();
    seedCouple(ctx);
    const ours = await run(ctx.provide(createCollectionProgram(USER_A, { name: 'Ours' })));
    const theirs = await run(ctx.provide(createCollectionProgram(USER_C, { name: 'Theirs' })));

    const a = await run(ctx.provide(listCollectionsProgram(USER_A)));
    expect(a.map((c) => c.id)).toEqual([ours.id]);

    const c = await run(ctx.provide(listCollectionsProgram(USER_C)));
    expect(c.map((c) => c.id)).toEqual([theirs.id]);

    // B (SPACE_1) cannot touch C's shelf; C cannot touch A's shelf.
    expect(await failureOf(ctx.provide(deleteCollectionProgram(USER_B, theirs.id)))).toBeInstanceOf(NotFoundError);
    expect(await failureOf(ctx.provide(deleteCollectionProgram(USER_C, ours.id)))).toBeInstanceOf(NotFoundError);
  });
});
