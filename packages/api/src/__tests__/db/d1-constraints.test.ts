import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTestD1, type ShimD1 } from '../../effects/test-harness';

/**
 * D1 constraint tests — run against the real baseline migration SQL on the
 * better-sqlite3 shim. These pin the storage-layer invariants:
 * - 23 tables, foreign keys ON,
 * - partial uniques (one active membership per user, one active partner per
 *   space, moments clientId idempotency),
 * - CHECK constraints carried over from the Postgres schema,
 * - D1 batch atomicity (all-or-nothing),
 * - guarded updates report affected rows (0 = guard failed).
 */

function insertUser(d1: ShimD1, id: string, email: string): void {
  d1.runSync('insert into users (id, email, name) values (?, ?, ?)', id, email, `User ${id}`);
}

function insertSpace(d1: ShimD1, id: string, ownerId: string): void {
  d1.runSync(
    'insert into spaces (id, name, relationship_start_date, created_by_user_id) values (?, ?, ?, ?)',
    id,
    'space',
    '2024-06-01',
    ownerId
  );
}

function insertMember(
  d1: ShimD1,
  spaceId: string,
  userId: string,
  role: 'you' | 'partner',
  state: 'active' | 'left' = 'active'
): void {
  d1.runSync(
    'insert into space_members (space_id, user_id, role, state) values (?, ?, ?, ?)',
    spaceId,
    userId,
    role,
    state
  );
}

describe('D1 baseline', () => {
  it('applies the migration with all 23 tables', () => {    const d1 = createTestD1();
    const rows = d1.rawDb
      .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
      .all() as Array<{ name: string }>;
    expect(rows.map((r) => r.name).sort()).toEqual(
      [
        'auth_accounts',
        'calendar_events',
        'event_proposals',
        'imported_milestones',
        'letters',
        'location_shares',
        'media_objects',
        'moment_attachments',
        'moment_reads',
        'moments',
        'oauth_states',
        'processed_webhook_events',
        'push_tokens',
        'someday_items',
        'space_activity',
        'space_invites',
        'space_members',
        'space_plus_entitlements',
        'spaces',
        'user_preferences',
        'user_sessions',
        'users',
        'weekly_answers',
      ].sort()
    );
  });

  it('enables foreign keys', () => {
    const d1 = createTestD1();
    expect(d1.rawDb.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('cascades deletes (user → sessions/accounts)', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    d1.runSync(
      'insert into user_sessions (id, user_id, token, expires_at) values (?, ?, ?, ?)',
      's1',
      'u1',
      'tok-1',
      Date.now() + 1000
    );
    d1.runSync(
      'insert into auth_accounts (id, user_id, account_id, provider_id) values (?, ?, ?, ?)',
      'a1',
      'u1',
      'acc',
      'google'
    );
    d1.runSync('delete from users where id = ?', 'u1');
    expect(d1.rawDb.prepare('select count(*) as n from user_sessions').get()).toEqual({ n: 0 });
    expect(d1.rawDb.prepare('select count(*) as n from auth_accounts').get()).toEqual({ n: 0 });
  });

  it('provides DB-level defaults for created/updated timestamps', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    const row = d1.rawDb.prepare('select created_at from users where id = ?').get('u1') as {
      created_at: number;
    };
    expect(row.created_at).toBeTypeOf('number');
    expect(row.created_at).toBeGreaterThan(0);
  });
});

describe('space invariants (partial uniques)', () => {
  it('allows one active membership per user', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    insertSpace(d1, 's2', 'u1');
    insertMember(d1, 's1', 'u1', 'you');
    expect(() => insertMember(d1, 's2', 'u1', 'you')).toThrow(/UNIQUE constraint failed/);
  });

  it('allows a left membership to be replaced by a new active one', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    insertSpace(d1, 's2', 'u1');
    insertMember(d1, 's1', 'u1', 'you', 'left');
    expect(() => insertMember(d1, 's2', 'u1', 'you')).not.toThrow();
  });

  it('rejects a second active partner per space', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertUser(d1, 'u2', 'c@d.co');
    insertUser(d1, 'u3', 'e@f.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');
    insertMember(d1, 's1', 'u2', 'partner');
    expect(() => insertMember(d1, 's1', 'u3', 'partner')).toThrow(/UNIQUE constraint failed/);
  });

  it('allows a partner role to coexist with the you role', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertUser(d1, 'u2', 'c@d.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');
    expect(() => insertMember(d1, 's1', 'u2', 'partner')).not.toThrow();
  });
});

describe('moments clientId idempotency', () => {
  const momentColumns =
    'id, space_id, created_by_user_id, author_role, author_name, type, title, body, occurred_at';

  it('rejects a duplicate (space, clientId) while live', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');
    d1.runSync(
      `insert into moments (${momentColumns}, client_id) values (?, ?, ?, 'you', 'A', 'note', 't', '', ?, ?)`,
      'm1',
      's1',
      'u1',
      Date.now(),
      'draft-1'
    );
    expect(() =>
      d1.runSync(
        `insert into moments (${momentColumns}, client_id) values (?, ?, ?, 'you', 'A', 'note', 't', '', ?, ?)`,
        'm2',
        's1',
        'u1',
        Date.now(),
        'draft-1'
      )
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('allows the same clientId again after a tombstone', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');
    d1.runSync(
      `insert into moments (${momentColumns}, client_id, deleted_at) values (?, ?, ?, 'you', 'A', 'note', 't', '', ?, ?, ?)`,
      'm1',
      's1',
      'u1',
      Date.now(),
      'draft-1',
      Date.now()
    );
    expect(() =>
      d1.runSync(
        `insert into moments (${momentColumns}, client_id) values (?, ?, ?, 'you', 'A', 'note', 't', '', ?, ?)`,
        'm2',
        's1',
        'u1',
        Date.now(),
        'draft-1'
      )
    ).not.toThrow();
  });

  it('allows the same clientId for DIFFERENT creators (creator-scoped unique)', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertUser(d1, 'u2', 'b@b.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');
    insertMember(d1, 's1', 'u2', 'partner');
    d1.runSync(
      `insert into moments (${momentColumns}, client_id) values (?, ?, ?, 'you', 'A', 'note', 't', '', ?, ?)`,
      'm1',
      's1',
      'u1',
      Date.now(),
      'draft-1'
    );
    // Same (space, clientId) but a different creator is a FRESH row —
    // idempotency is per-sender, never a cross-user address.
    expect(() =>
      d1.runSync(
        `insert into moments (${momentColumns}, client_id) values (?, ?, ?, 'partner', 'B', 'note', 't', '', ?, ?)`,
        'm2',
        's1',
        'u2',
        Date.now(),
        'draft-1'
      )
    ).not.toThrow();
  });

  it('rejects the same clientId from the same creator while live', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');
    d1.runSync(
      `insert into moments (${momentColumns}, client_id) values (?, ?, ?, 'you', 'A', 'note', 't', '', ?, ?)`,
      'm1',
      's1',
      'u1',
      Date.now(),
      'draft-1'
    );
    expect(() =>
      d1.runSync(
        `insert into moments (${momentColumns}, client_id) values (?, ?, ?, 'you', 'A', 'note', 't', '', ?, ?)`,
        'm2',
        's1',
        'u1',
        Date.now(),
        'draft-1'
      )
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('allows many NULL clientId rows', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');
    for (let i = 0; i < 3; i++) {
      expect(() =>
        d1.runSync(
          `insert into moments (${momentColumns}) values (?, ?, ?, 'you', 'A', 'note', 't', '', ?)`,
          `m${i}`,
          's1',
          'u1',
          Date.now()
        )
      ).not.toThrow();
    }
  });
});

describe('CHECK constraints', () => {
  it('rejects an invalid Plus entitlement status', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    expect(() =>
      d1.runSync(
        `insert into space_plus_entitlements
           (space_id, purchaser_user_id, provider, entitlement_id, status, last_event_id, last_event_at_ms)
         values (?, ?, 'revenuecat', 'plus', 'bogus', 'evt-1', ?)`,
        's1',
        'u1',
        Date.now()
      )
    ).toThrow(/CHECK constraint failed/);
  });

  it('cascades space deletes to the Plus entitlement row', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    d1.runSync(
      `insert into space_plus_entitlements
         (space_id, purchaser_user_id, provider, entitlement_id, status, last_event_id, last_event_at_ms)
       values (?, ?, 'revenuecat', 'plus', 'active', 'evt-1', ?)`,
      's1',
      'u1',
      Date.now()
    );
    d1.runSync('delete from spaces where id = ?', 's1');
    expect(d1.rawDb.prepare('select count(*) as n from space_plus_entitlements').get()).toEqual({
      n: 0,
    });
  });

  it('rejects an invalid someday category', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');
    expect(() =>
      d1.runSync(
        'insert into someday_items (id, space_id, created_by_user_id, title, category) values (?, ?, ?, ?, ?)',
        'x1',
        's1',
        'u1',
        't',
        'nope'
      )
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects out-of-range coordinates', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');
    expect(() =>
      d1.runSync(
        'insert into location_shares (id, user_id, space_id, mode, latitude, longitude, reported_at) values (?, ?, ?, ?, ?, ?, ?)',
        'l1',
        'u1',
        's1',
        'live',
        95,
        0,
        Date.now()
      )
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects an invalid proposal status', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');
    expect(() =>
      d1.runSync(
        "insert into event_proposals (id, space_id, proposer_user_id, title, proposed_start, proposed_end, status) values (?, ?, ?, 't', ?, ?, ?)",
        'p1',
        's1',
        'u1',
        Date.now() + 1000,
        Date.now() + 2000,
        'maybe'
      )
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects an invalid media upload state', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');
    expect(() =>
      d1.runSync(
        'insert into media_objects (id, space_id, created_by_user_id, filename, mime_type, size_bytes, storage_key, upload_state) values (?, ?, ?, ?, ?, ?, ?, ?)',
        'mo1',
        's1',
        'u1',
        'a.jpg',
        'image/jpeg',
        10,
        'k1',
        'nope'
      )
    ).toThrow(/CHECK constraint failed/);
  });
});

describe('D1 atomicity primitives', () => {
  it('batch rolls back everything when any statement fails', async () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');

    const ok = d1.prepare(
      "insert into moments (id, space_id, created_by_user_id, author_role, author_name, type, title, body, occurred_at) values ('m1', 's1', 'u1', 'you', 'A', 'note', 't', '', 1)"
    );
    const dup = d1.prepare(
      "insert into moments (id, space_id, created_by_user_id, author_role, author_name, type, title, body, occurred_at) values ('m1', 's1', 'u1', 'you', 'A', 'note', 't', '', 1)"
    );
    const other = d1.prepare(
      "insert into moments (id, space_id, created_by_user_id, author_role, author_name, type, title, body, occurred_at) values ('m2', 's1', 'u1', 'you', 'A', 'note', 't', '', 1)"
    );

    await expect(d1.batch([ok, dup, other])).rejects.toThrow();
    // Nothing from the batch landed.
    const count = d1.rawDb.prepare('select count(*) as n from moments').get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('guarded updates report affected rows (0 when the guard fails)', async () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');

    const hit = await d1
      .prepare("update space_members set state = 'left' where user_id = ? and state = 'active'")
      .bind('u1')
      .run();
    expect(hit.meta?.changes).toBe(1);

    const miss = await d1
      .prepare("update space_members set state = 'left' where user_id = ? and state = 'active'")
      .bind('u1')
      .run();
    expect(miss.meta?.changes).toBe(0);
  });

  it('keeps media size_bytes as an INTEGER', () => {
    const d1 = createTestD1();
    insertUser(d1, 'u1', 'a@b.co');
    insertSpace(d1, 's1', 'u1');
    insertMember(d1, 's1', 'u1', 'you');
    d1.runSync(
      'insert into media_objects (id, space_id, created_by_user_id, filename, mime_type, size_bytes, storage_key) values (?, ?, ?, ?, ?, ?, ?)',
      'mo1',
      's1',
      'u1',
      'a.jpg',
      'image/jpeg',
      104857600,
      'k1'
    );
    const row = d1.rawDb.prepare('select size_bytes from media_objects where id = ?').get('mo1') as {
      size_bytes: number;
    };
    expect(row.size_bytes).toBe(104857600);
  });
});

describe('migration 0003 (nullable relationship_start_date)', () => {
  function preMigrationSql(): string {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'drizzle-d1');
    return ['0000_round_xavin.sql', '0001_high_obadiah_stane.sql', '0002_creator_scoped_moments.sql']
      .map((file) => fs.readFileSync(path.join(dir, file), 'utf8'))
      .join('\n');
  }

  function migrationSql(): string {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'drizzle-d1');
    return fs.readFileSync(path.join(dir, '0003_silky_shaman.sql'), 'utf8');
  }

  it('preserves populated rows and then accepts null dates', () => {
    const d1 = createTestD1(preMigrationSql());
    insertUser(d1, 'u1', 'a@b.co');
    d1.runSync(
      'insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
      's1',
      'Our Space',
      'Partner',
      '2024-06-01',
      'u1',
      1000,
      1000
    );

    d1.apply(migrationSql());

    // Existing populated row survives byte-for-byte.
    const kept = d1.rawDb
      .prepare('select id, name, partner_name, relationship_start_date, created_by_user_id from spaces where id = ?')
      .get('s1') as Record<string, unknown>;
    expect(kept).toEqual({
      id: 's1',
      name: 'Our Space',
      partner_name: 'Partner',
      relationship_start_date: '2024-06-01',
      created_by_user_id: 'u1',
    });

    // The column is now nullable.
    const info = d1.rawDb.pragma('table_info(spaces)') as Array<{ name: string; notnull: number }>;
    expect(info.find((col) => col.name === 'relationship_start_date')?.notnull).toBe(0);

    // Null inserts work post-migration.
    d1.runSync(
      'insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
      's2',
      'New Space',
      null,
      null,
      'u1',
      2000,
      2000
    );
    const fresh = d1.rawDb
      .prepare('select partner_name, relationship_start_date from spaces where id = ?')
      .get('s2') as Record<string, unknown>;
    expect(fresh).toEqual({ partner_name: null, relationship_start_date: null });
  });
});

describe('migration 0006 (pairing binding + invite revocation)', () => {
  function sqlInOrder(names: string[]): string {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'drizzle-d1');
    return names.map((file) => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n');
  }

  it('backfills the binding from the earliest partner member, including left ones', () => {
    // Pre-0006 world: B joined then left; no binding column exists yet.
    const d1 = createTestD1(
      sqlInOrder([
        '0000_round_xavin.sql',
        '0001_high_obadiah_stane.sql',
        '0002_creator_scoped_moments.sql',
        '0003_silky_shaman.sql',
        '0004_busy_warbound.sql',
        '0005_chemical_rhodey.sql',
      ])
    );
    insertUser(d1, 'u1', 'a@b.co');
    insertUser(d1, 'u2', 'b@b.co');
    insertUser(d1, 'u3', 'c@b.co');
    insertSpace(d1, 's1', 'u1');
    insertSpace(d1, 's2', 'u3');
    insertMember(d1, 's1', 'u1', 'you');
    insertMember(d1, 's1', 'u2', 'partner');
    insertMember(d1, 's2', 'u3', 'you');
    // B leaves s1: the membership row goes terminal, history stays.
    d1.runSync("update space_members set state = 'left', left_at = ? where space_id = ? and user_id = ?", 2000, 's1', 'u2');

    d1.apply(sqlInOrder(['0006_polite_natasha_romanoff.sql']));

    // s1 (paired-then-left) is bound to B; s2 (never paired) stays open.
    const bound = d1.rawDb.prepare('select partner_user_id from spaces where id = ?').get('s1') as {
      partner_user_id: string | null;
    };
    expect(bound).toEqual({ partner_user_id: 'u2' });
    const open = d1.rawDb.prepare('select partner_user_id from spaces where id = ?').get('s2') as {
      partner_user_id: string | null;
    };
    expect(open).toEqual({ partner_user_id: null });

    // revoked_at exists and defaults null (old invites stay usable-by-rule).
    const invite = d1.rawDb.prepare('select revoked_at from space_invites limit 1').get() as
      | { revoked_at: number | null }
      | undefined;
    expect(invite === undefined || invite.revoked_at === null).toBe(true);
  });
});

describe('migration chain 0000 → current (P8-era upgrade)', () => {
  function sqlInOrder(names: string[]): string {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'drizzle-d1');
    return names.map((file) => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n');
  }

  it('upgrades a populated pre-0003 database through every step without loss', () => {
    // A P8-era database: space + both members + redeemed invite + content.
    const d1 = createTestD1(
      sqlInOrder(['0000_round_xavin.sql', '0001_high_obadiah_stane.sql', '0002_creator_scoped_moments.sql'])
    );
    insertUser(d1, 'u1', 'a@b.co');
    insertUser(d1, 'u2', 'b@b.co');
    d1.runSync(
      'insert into spaces (id, name, partner_name, relationship_start_date, created_by_user_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
      's1',
      'Our Space',
      'Partner',
      '2024-06-01',
      'u1',
      1000,
      1000
    );
    insertMember(d1, 's1', 'u1', 'you');
    insertMember(d1, 's1', 'u2', 'partner');
    d1.runSync(
      "insert into space_invites (id, space_id, code, code_normalized, created_by_user_id, redeemed_by_user_id, redeemed_at, created_at) values (?, ?, 'ABC123', 'ABC123', 'u1', 'u2', 2000, 1000)",
      'i1',
      's1'
    );
    d1.runSync(
      `insert into moments (id, space_id, created_by_user_id, author_role, author_name, type, title, body, occurred_at, created_at)
       values ('m1', 's1', 'u1', 'you', 'Aoi', 'note', 't', 'b', 3000, 3000)`
    );
    d1.runSync(
      `insert into letters (id, space_id, author_user_id, caption, body, sealed_until, created_at)
       values ('l1', 's1', 'u1', 'c', 'secret', 9999999999999, 3000)`
    );

    // Apply the rest of the journal in order (0003 → 0005).
    d1.apply(sqlInOrder(['0003_silky_shaman.sql', '0004_busy_warbound.sql', '0005_chemical_rhodey.sql']));

    // All content survives byte-for-byte.
    expect(
      d1.rawDb.prepare('select count(*) as n from moments').get()
    ).toEqual({ n: 1 });
    expect(
      d1.rawDb.prepare('select body from letters where id = ?').get('l1')
    ).toEqual({ body: 'secret' });
    expect(
      d1.rawDb.prepare('select redeemed_by_user_id from space_invites where id = ?').get('i1')
    ).toEqual({ redeemed_by_user_id: 'u2' });
    expect(
      d1.rawDb.prepare("select count(*) as n from space_members where state = 'active'").get()
    ).toEqual({ n: 2 });

    // New tables accept rows against the old ones (FKs hold).
    d1.runSync(
      `insert into space_plus_entitlements
         (space_id, purchaser_user_id, provider, entitlement_id, status, last_event_id, last_event_at_ms, created_at, updated_at)
       values ('s1', 'u1', 'revenuecat', 'plus', 'active', 'evt-1', 4000, 4000, 4000)`
    );
    d1.runSync(
      `insert into processed_webhook_events (event_id, received_at) values ('evt-1', 4000)`
    );
    expect(
      d1.rawDb.prepare('select count(*) as n from space_plus_entitlements').get()
    ).toEqual({ n: 1 });

    // Journal order matches the files on disk (what wrangler applies).
    const journal = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'drizzle-d1', 'meta', '_journal.json'),
        'utf8'
      )
    ) as { entries: Array<{ tag: string }> };
    const files = fs
      .readdirSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'drizzle-d1')
      )
      .filter((name) => /^\d{4}_.*\.sql$/.test(name))
      .sort()
      .map((name) => name.replace(/\.sql$/, ''));
    expect(journal.entries.map((entry) => entry.tag)).toEqual(files);
  });
});
