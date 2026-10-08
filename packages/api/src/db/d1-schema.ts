import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * D1 (SQLite) schema — the fresh backend baseline for the Cloudflare
 * migration. Semantics carried over 1:1 from the Postgres schema; storage
 * mapped per the locked design:
 * - timestamps: INTEGER epoch-ms (`mode: 'timestamp_ms'`)
 * - jsonb → text JSON (`mode: 'json'`), double precision → `real`,
 *   `date` → text `YYYY-MM-DD`, `size_bytes` → INTEGER
 * - `users` keeps its name (15 FK targets stay valid) with Better Auth-aligned
 *   columns (`name`, `image`, `email_verified`)
 * - `user_sessions`/`auth_accounts`/`oauth_states` carry Better Auth's
 *   session/account/verification shapes so Stage 4 wires the adapter directly.
 * - partial uniques enforce the space invariants at the storage layer:
 *   one active membership per user, one active partner per space, and
 *   moments `clientId` idempotency.
 */

// ── Users ──────────────────────────────────────────────────────────────────
// Better Auth user shape: name/image/email_verified. Account deletion
// tombstones the row (email/avatar/name scrubbed, deletedAt set) instead
// of hard-deleting it, so shared-content FKs stay valid; see
// deleteAccountProgram for the exact purge boundary.

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').unique(),
  name: text('name').notNull(),
  image: text('image'),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
});

// ── Auth Accounts ──────────────────────────────────────────────────────────
// Better Auth `account` model (installed 1.6.26 — verified against the
// package's own schema: providerId + accountId, no providerAccountId).
// Unique (provider_id, account_id) makes cross-provider linking safe
// (verified-email-only, Stage 4).

export const authAccounts = sqliteTable(
  'auth_accounts',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_auth_accounts_provider_account').on(table.providerId, table.accountId),
    index('idx_auth_accounts_user').on(table.userId),
  ]
);

// ── User Sessions ──────────────────────────────────────────────────────────
// Better Auth `session` model: signed JWT session tokens + DB rows. The token
// column is the opaque bearer credential (never stored in logs).

export const userSessions = sqliteTable(
  'user_sessions',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (table) => [index('idx_user_sessions_user').on(table.userId)]
);

// ── OAuth States → Better Auth `verification` store ────────────────────────
// Repurposed: Better Auth persists OAuth state + PKCE challenges here.

export const oauthStates = sqliteTable(
  'oauth_states',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (table) => [index('idx_oauth_states_identifier').on(table.identifier)]
);

// ── Spaces ─────────────────────────────────────────────────────────────────

export const spaces = sqliteTable('spaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  // Display name of the partner from the creator's perspective. Set at
  // creation (creator's wording) and replaced with the joining user's real
  // name when the partner redeems the invite. NULL until a partner joins.
  partnerName: text('partner_name'),
  // Nullable since migration 0003: an unset start date stays NULL (absence,
  // never a fabricated placeholder). Read paths must tolerate null.
  relationshipStartDate: text('relationship_start_date'), // YYYY-MM-DD | null
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => users.id),
  // Pairing binding (migration 0006): the user id of the FIRST partner who
  // ever joined this space, set atomically on first join, never cleared.
  // A space that has ever been paired is permanently bound to that pairing's
  // history — a different identity may never occupy the partner slot, even
  // after the bound partner leaves. Deliberately NO foreign key: the binding
  // must survive the bound user's account deletion (their member row
  // cascades away, the pairing record must not).
  partnerUserId: text('partner_user_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
});

// ── Space Members ──────────────────────────────────────────────────────────
// The two partial uniques are the storage-level space invariants:
// - one ACTIVE membership per user (create/join conflict → 409)
// - one ACTIVE partner per space (second partner → conflict)

export const spaceMembers = sqliteTable(
  'space_members',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    state: text('state').notNull().default('active'),
    joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    leftAt: integer('left_at', { mode: 'timestamp_ms' }),
    // Opt-in to location sharing. NULL = not consented (the default for
    // everyone, always). Set to the opt-in moment when consented; clearing
    // it back to NULL is a one-tap revocation that also deletes any share row.
    locationConsentAt: integer('location_consent_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.userId] }),
    index('idx_space_members_user_state').on(table.userId, table.state),
    uniqueIndex('uq_space_members_user_active')
      .on(table.userId)
      .where(sql`${table.state} = 'active'`),
    uniqueIndex('uq_space_members_space_partner_active')
      .on(table.spaceId)
      .where(sql`${table.state} = 'active' and ${table.role} = 'partner'`),
    check('ck_space_members_role', sql`${table.role} in ('you', 'partner')`),
    check('ck_space_members_state', sql`${table.state} in ('active', 'left')`),
  ]
);

// ── Space Invites ──────────────────────────────────────────────────────────

export const spaceInvites = sqliteTable(
  'space_invites',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    codeNormalized: text('code_normalized').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    redeemedByUserId: text('redeemed_by_user_id').references(() => users.id),
    redeemedAt: integer('redeemed_at', { mode: 'timestamp_ms' }),
    // Invite rotation (migration 0006): generating a new code revokes all
    // prior unredeemed codes for the space. Join redeems only unrevoked
    // codes, so a leaked/rotated code is deterministically dead.
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex('uq_space_invites_code_normalized').on(table.codeNormalized)]
);

// ── Moments ────────────────────────────────────────────────────────────────
// `clientId` idempotency: optional client-supplied key; the partial unique
// makes duplicate creates with the same (space, createdBy, clientId) a
// no-op. Rows with NULL clientId never collide. The unique is scoped to the
// CREATOR: a key is an idempotency hint for the user who sent it, never a
// cross-user address (two partners generating a colliding key must not
// resolve to each other's moment).

export const moments = sqliteTable(
  'moments',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    authorRole: text('author_role').notNull(),
    authorName: text('author_name').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    targetAt: integer('target_at', { mode: 'timestamp_ms' }),
    mediaPreview: text('media_preview'),
    audioUri: text('audio_uri'),
    // Stable media object id (media_objects.id) when the moment carries
    // media. Deliberately NO foreign key: media rows are soft-deleted and
    // later purged, and a moment must keep rendering (its stable serve URL
    // degrades to unavailable) rather than fail a purge. Reserved for the
    // future E2EE migration: the id is content-addressed, never a URL.
    mediaId: text('media_id'),
    clientId: text('client_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('idx_moments_space_occurred_id')
      .on(table.spaceId, table.occurredAt, table.id)
      .where(sql`${table.deletedAt} is null`),
    index('idx_moments_owner')
      .on(table.createdByUserId, table.id)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex('uq_moments_space_user_client_id')
      .on(table.spaceId, table.createdByUserId, table.clientId)
      .where(sql`${table.deletedAt} is null`),
    check(
      'ck_moments_type',
      sql`${table.type} in ('note', 'milestone', 'date', 'goal', 'media', 'trace')`
    ),
    check(
      'ck_moments_author_role',
      sql`${table.authorRole} in ('you', 'partner')`
    ),
  ]
);

// ── Moment Attachments (ordered multi-attachment) ────────────────────────
// One row per (moment, media) in client-supplied order (`position`).
// `moment_id` cascades (space delete → moments → attachments). `media_id`
// deliberately has NO foreign key — same purge semantics as
// `moments.media_id`: media rows are soft-deleted then purged, and a moment
// must keep rendering (its stable serve URL degrades to unavailable)
// rather than fail a purge. `kind` is image|audio only — video stays
// rejected until a privacy stripping + playback pipeline exists.

export const momentAttachments = sqliteTable(
  'moment_attachments',
  {
    momentId: text('moment_id')
      .notNull()
      .references(() => moments.id, { onDelete: 'cascade' }),
    mediaId: text('media_id').notNull(),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.momentId, table.mediaId] }),
    uniqueIndex('uq_moment_attachments_moment_position').on(table.momentId, table.position),
    check('ck_moment_attachments_kind', sql`${table.kind} in ('image', 'audio')`),
    check('ck_moment_attachments_position', sql`${table.position} >= 0`),
  ]
);

// ── Moment Reads (per-viewer synced read state) ──────────────────────────
// One row per (moment, viewer) when the viewer has read a partner moment.
// Own moments are intrinsically read (never rows here); deleted/goal
// moments are never eligible. All FKs cascade so user/space/moment deletion
// cleans read state without orphans.

export const momentReads = sqliteTable(
  'moment_reads',
  {
    momentId: text('moment_id')
      .notNull()
      .references(() => moments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    readAt: integer('read_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.momentId, table.userId] }),
    index('idx_moment_reads_user_space').on(table.userId, table.spaceId),
  ]
);

// ── Space Activity (change log) ───────────────────────────────────────────

export const spaceActivity = sqliteTable(
  'space_activity',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    subjectId: text('subject_id'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_space_activity_space_occurred').on(table.spaceId, table.occurredAt),
    check(
      'ck_space_activity_kind',
      sql`${table.kind} in ('moment_deleted', 'moment_edited')`
    ),
  ]
);

// ── Calendar Events ────────────────────────────────────────────────────────

export const calendarEvents = sqliteTable(
  'calendar_events',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    actor: text('actor').notNull(),
    actorName: text('actor_name').notNull(),
    title: text('title').notNull(),
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
    endsAt: integer('ends_at', { mode: 'timestamp_ms' }).notNull(),
    labelPreset: text('label_preset').notNull(),
    labelCustomText: text('label_custom_text'),
    location: text('location'),
    reminderMinutesBefore: text('reminder_minutes_before', { mode: 'json' }).$type<number[]>(),
    allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
    together: integer('together', { mode: 'boolean' }).notNull().default(false),
    recurrence: text('recurrence').notNull().default('none'),
    recurrenceGroupId: text('recurrence_group_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('idx_calendar_events_space_starts')
      .on(table.spaceId, table.startsAt)
      .where(sql`${table.deletedAt} is null`),
    index('idx_calendar_events_owner')
      .on(table.createdByUserId, table.id)
      .where(sql`${table.deletedAt} is null`),
    check('ck_calendar_events_actor', sql`${table.actor} in ('you', 'partner')`),
    check(
      'ck_calendar_events_label_preset',
      sql`${table.labelPreset} in ('Work', 'Gym', 'Travel', 'Date', 'Family', 'Other')`
    ),
    check(
      'ck_calendar_events_recurrence',
      sql`${table.recurrence} in ('none', 'weekly')`
    ),
  ]
);

// ── Someday Items ──────────────────────────────────────────────────────────

export const somedayItems = sqliteTable(
  'someday_items',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    note: text('note'),
    category: text('category').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    checkedAt: integer('checked_at', { mode: 'timestamp_ms' }),
    checkedByUserId: text('checked_by_user_id').references(() => users.id),
  },
  (table) => [
    index('idx_someday_items_space').on(table.spaceId),
    check(
      'ck_someday_items_category',
      sql`${table.category} in ('place', 'food', 'film', 'other')`
    ),
  ]
);

// ── Collections (authored shelves) ─────────────────────────────────────────
// A shelf is a name + optional emoji; an item is a title + optional one-line
// note + optional single link. Both members share and author. Removals are
// soft-deletes, and `position` is append-on-create so drag-reorder is
// additive later without a migration.

export const collections = sqliteTable(
  'collections',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    emoji: text('emoji'),
    color: text('color'),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('idx_collections_space')
      .on(table.spaceId)
      .where(sql`${table.deletedAt} is null`),
  ]
);

export const collectionItems = sqliteTable(
  'collection_items',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    note: text('note'),
    link: text('link'),
    /** A cover photo's URI. */
    coverUrl: text('cover_url'),
    /** How far along it is: want | doing | done. */
    status: text('status'),
    /** Out of ten, one score for the pair. */
    score: integer('score'),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('idx_collection_items_collection')
      .on(table.collectionId)
      .where(sql`${table.deletedAt} is null`),
  ]
);

// ── Weekly Answers ─────────────────────────────────────────────────────────

export const weeklyAnswers = sqliteTable(
  'weekly_answers',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weekKey: text('week_key').notNull(),
    questionId: integer('question_id').notNull(),
    answer: text('answer').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_weekly_answers_space_user_week').on(
      table.spaceId,
      table.userId,
      table.weekKey
    ),
    index('idx_weekly_answers_space_week').on(table.spaceId, table.weekKey),
  ]
);

// ── Location Shares ────────────────────────────────────────────────────────

export const locationShares = sqliteTable(
  'location_shares',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    destination: text('destination', { mode: 'json' }).$type<{
      name: string;
      latitude: number;
      longitude: number;
      radiusMeters: number;
    }>(),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    accuracyMeters: real('accuracy_meters'),
    reportedAt: integer('reported_at', { mode: 'timestamp_ms' }).notNull(),
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (table) => [
    check(
      'ck_location_shares_mode',
      sql`${table.mode} in ('live', 'until_arrive', 'on_request_granted')`
    ),
    check('ck_location_shares_latitude', sql`${table.latitude} between -90 and 90`),
    check('ck_location_shares_longitude', sql`${table.longitude} between -180 and 180`),
  ]
);

// ── Letters (time capsule) ─────────────────────────────────────────────────

export const letters = sqliteTable(
  'letters',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    authorUserId: text('author_user_id')
      .notNull()
      .references(() => users.id),
    caption: text('caption'),
    body: text('body').notNull(),
    sealedUntil: integer('sealed_until', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    openedAt: integer('opened_at', { mode: 'timestamp_ms' }),
    openedByUserId: text('opened_by_user_id').references(() => users.id),
  },
  (table) => [index('idx_letters_space_sealed_until').on(table.spaceId, table.sealedUntil)]
);

// ── Push Tokens ────────────────────────────────────────────────────────────

export const pushTokens = sqliteTable(
  'push_tokens',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expoPushToken: text('expo_push_token').notNull().unique(),
    platform: text('platform').notNull().default('unknown'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
  },
  (table) => [
    index('idx_push_tokens_user').on(table.userId),
    check(
      'ck_push_tokens_platform',
      sql`${table.platform} in ('ios', 'android', 'web', 'unknown')`
    ),
  ]
);

// ── Media Objects ──────────────────────────────────────────────────────────
// Stable content-hash keys; reserved E2EE/offline fields (NULL, no behavior).

export const mediaObjects = sqliteTable(
  'media_objects',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    uploadState: text('upload_state').notNull().default('pending'),
    contentHash: text('content_hash'),
    variantKeys: text('variant_keys', { mode: 'json' }).$type<Record<string, string>>(),
    processingAttempts: integer('processing_attempts').notNull().default(0),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    // Reserved for future E2EE: always NULL today, never read.
    encryptionScheme: text('encryption_scheme'),
    encryptionMeta: text('encryption_meta', { mode: 'json' }).$type<Record<string, unknown>>(),
    clientSha256: text('client_sha256'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('idx_media_objects_space').on(table.spaceId),
    check(
      'ck_media_objects_upload_state',
      sql`${table.uploadState} in ('pending', 'complete', 'failed')`
    ),
  ]
);

// ── Album Media (E2EE shared library) ─────────────────────────────────────
// The server is a dumb, membership-gated pipe. Sealed ciphertext bytes live
// in R2 at the deterministic key `album/{spaceId}/{mediaId}.bin`; the row
// carries only the server-opaque sealed nonce, the space-key-wrapped media
// key, and non-secret metadata (size, MIME, person tag). `byte_length` is the
// declared ciphertext length the completion head-verify checks against.

export const albumMedia = sqliteTable(
  'album_media',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    mimeType: text('mime_type').notNull(),
    byteLength: integer('byte_length').notNull(),
    width: integer('width'),
    height: integer('height'),
    personTag: text('person_tag'),
    sealedNonce: text('sealed_nonce').notNull(),
    wrappedKeyNonce: text('wrapped_key_nonce').notNull(),
    wrappedKeyCiphertext: text('wrapped_key_ciphertext').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    uploadState: text('upload_state').notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    /**
     * The object's identity at the moment it was finalised.
     *
     * The presigned PUT is a conditional create, so a replay cannot rewrite a
     * completed object. That defence lives in object storage, and whether it
     * enforces the condition is not something this server can prove, so the
     * object's etag and size are pinned here as well and the serve path refuses
     * anything that no longer matches. The pin is the read-side check that holds
     * even when the condition is not honoured.
     */
    completedEtag: text('completed_etag'),
    completedSize: integer('completed_size'),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    /**
     * When the ciphertext was confirmed gone from storage.
     *
     * Distinct from `deleted_at`, which is the user-visible act. A soft delete
     * hides the photo immediately, but its bytes stay accounted for until this
     * is set — which only happens after a fail-closed delete, and never while an
     * upload authorization could still recreate the object. The shared quota
     * counts actual storage, not the tombstone.
     */
    storageReclaimedAt: integer('storage_reclaimed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('idx_album_media_space').on(table.spaceId),
    check(
      'ck_album_media_upload_state',
      sql`${table.uploadState} in ('pending', 'expiring', 'complete', 'failed')`
    ),
    check(
      'ck_album_media_person_tag',
      sql`${table.personTag} is null or ${table.personTag} in ('you', 'partner')`
    ),
  ]
);

// ── Album Backups (space key envelopes) ───────────────────────────────────
// One opaque JSON payload per space: public identities, signed device keys,
// and one wrapped space-key envelope per authorised device. Not secret to the
// server's threat model, but treated with the same membership gate as media.

export const albumBackups = sqliteTable('album_backups', {
  spaceId: text('space_id')
    .primaryKey()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  payload: text('payload').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
});

// ── Album Protocol (the new trust state) ───────────────────────────────────
// Beside the backup blob rather than replacing it: the session path still reads
// that one until the cutover. Every row keeps the signed object as validated
// canonical wire JSON and extracts only the fields the server needs for
// routing, ownership and monotonicity, so there is one representation of the
// signed object rather than two that can drift.
//
// The server never decides whether a signature is trustworthy. It decides who
// owns a row, whether a revision moved forward, and whether the caller is
// allowed to write it at all.

export const albumTrustAnchors = sqliteTable('album_trust_anchors', {
  spaceId: text('space_id')
    .primaryKey()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  payload: text('payload').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * A device's claim on its own id, before anything is signed.
 *
 * Without this, "first writer owns the device" is a race rather than a rule.
 * During enrolment the authorising device necessarily learns the recipient's id
 * and public keys, so it can PUT the recipient's record first and the row ends
 * up owned by the wrong account: cryptographically Bob's phone, administratively
 * Alice's, and Bob can never revise it.
 *
 * The recipient claims its id and keys first, and the final record has to match
 * the claim on owner and both keys.
 */
export const albumDeviceClaims = sqliteTable(
  'album_device_claims',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id),
    signingPublicKey: text('signing_public_key').notNull(),
    agreementPublicKey: text('agreement_public_key').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.deviceId] })]
);

/**
 * One row per device, owned by the account that first wrote it.
 *
 * `owner_user_id` is the fix for the hole the backup blob had: one shared bag
 * meant either member could rewrite the other's device rows. Here the first
 * writer owns the row and every later revision has to come from that same
 * account, which is enforceable without the server understanding any
 * signature. The owner comes from the device's claim, not from whoever wins the
 * first request.
 */
export const albumDeviceRecords = sqliteTable(
  'album_device_records',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id),
    revision: integer('revision').notNull(),
    payload: text('payload').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.deviceId] }),
    index('idx_album_device_records_owner').on(table.ownerUserId),
  ]
);

/**
 * Immutable per (space, generation, recipient, recipient revision, authoriser).
 *
 * The envelope binds the recipient's revision, so a reparented device needs a
 * new row rather than a mutated one. The authoriser is in the key too, because
 * without it any member could occupy a recipient's slot with an envelope the
 * client will reject, and the real authoriser could then never store the
 * legitimate one. All candidates are kept and the client accepts only the
 * envelope whose authoriser matches the record it already trusts.
 */
export const albumSpaceKeyEnvelopes = sqliteTable(
  'album_space_key_envelopes',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    generation: integer('generation').notNull(),
    recipientDeviceId: text('recipient_device_id').notNull(),
    recipientRevision: integer('recipient_revision').notNull(),
    authoriserDeviceId: text('authoriser_device_id').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.spaceId,
        table.generation,
        table.recipientDeviceId,
        table.recipientRevision,
        table.authoriserDeviceId,
      ],
    }),
  ]
);

/** One immutable row, generation 1 only until rotation exists. */
export const albumRecoveryEnvelopes = sqliteTable(
  'album_recovery_envelopes',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    generation: integer('generation').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.generation] })]
);

/**
 * Append-only, one row per tombstone rather than one row per target.
 *
 * A single row per target with last-write-wins would let a forged or untrusted
 * tombstone displace a valid one, and the client has logic specifically to
 * evaluate each tombstone's authority. Give it all of them.
 *
 * The unique index makes an exact retry idempotent rather than a second row.
 * Distinct tombstones still accumulate, which is why the write path also
 * enforces a ceiling.
 */
export const albumDeviceTombstones = sqliteTable(
  'album_device_tombstones',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    targetDeviceId: text('target_device_id').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('idx_album_device_tombstones_target').on(table.spaceId, table.targetDeviceId),
    uniqueIndex('uq_album_device_tombstones_payload').on(table.spaceId, table.payload),
  ]
);

/**
 * The signed-media upload lifecycle: one row per media, from reservation to
 * completion.
 *
 * It is the storage-accounting row for signed media — the single place those
 * bytes are counted — and the only thing that authorises an upload. It is
 * separate from `album_media` (the pre-cutover flow) so signed media stays
 * invisible to the legacy list and the legacy delete, which read that table.
 *
 *   pending  → complete   finalised, object pinned, quota held
 *   pending  → failed     abandoned: object deleted, quota released
 *
 * `expires_at` is set past the presigned URL's own expiry, so a reservation
 * never dies while its URL is still usable. Cleanup deletes the object before
 * flipping the row to `failed`, so a `failed` row never leaves untracked
 * storage behind.
 */
export const albumMediaReservations = sqliteTable(
  'album_media_reservations',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    mediaId: text('media_id').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    uploaderDeviceId: text('uploader_device_id').notNull(),
    generation: integer('generation').notNull(),
    byteLength: integer('byte_length').notNull(),
    state: text('state').notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    completedEtag: text('completed_etag'),
    completedSize: integer('completed_size'),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.mediaId] }),
    index('idx_album_media_reservations_state').on(table.spaceId, table.state),
    check(
      'ck_album_media_reservations_state',
      sql`${table.state} in ('pending', 'expiring', 'complete', 'failed')`
    ),
  ]
);

/**
 * One immutable signed manifest per media.
 *
 * The manifest is what makes the metadata authentic: the server currently holds
 * `createdAt`, dimensions, `byteLength`, the wrapped-key association and the
 * uploader in the clear and unauthenticated, so it can remix the archive
 * without reading a pixel. The uploader signs the canonical bytes, and any
 * device verifies them instead of trusting this row.
 *
 * There is no second revision. A delete does not rewrite it, because the device
 * deleting is usually not the device that uploaded: removal is its own signed
 * object. The primary key is the identity, so an exact retry is a no-op and a
 * different payload for the same `mediaId` is refused.
 *
 * `uploader_device_id` and `revision` are extracted from the signed payload for
 * routing and ordering only; they are not a second source of truth.
 */
export const albumMediaManifests = sqliteTable(
  'album_media_manifests',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    mediaId: text('media_id').notNull(),
    uploaderDeviceId: text('uploader_device_id').notNull(),
    revision: integer('revision').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.mediaId] })]
);

/**
 * Append-only media tombstone candidates.
 *
 * A tombstone is a claim, not a fact: the server cannot verify the signature,
 * so it stores every candidate and lets clients decide. One row per target with
 * last-write-wins would let a forged tombstone displace a valid one, and
 * tracking only the highest revision would let a bogus huge revision block a
 * legitimate one forever. So: one row per distinct tombstone, no monotonicity.
 *
 * The unique index makes an exact retry idempotent rather than a second row.
 * Distinct tombstones still accumulate, which is why the write path also
 * enforces a ceiling.
 *
 * Nothing here deletes ciphertext. A submitted tombstone is only a candidate
 * until a client authenticates it, so it must never trigger physical removal.
 */
export const albumMediaTombstones = sqliteTable(
  'album_media_tombstones',
  {
    id: text('id').primaryKey(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    mediaId: text('media_id').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('idx_album_media_tombstones_media').on(table.spaceId, table.mediaId),
    uniqueIndex('uq_album_media_tombstones_payload').on(table.spaceId, table.payload),
  ]
);

/**
 * One enrolment offer per device: the signed record an authoriser produced for
 * a device it did not own.
 *
 * This exists only because of an ownership rule. A device record row belongs to
 * the account that claimed the device, so the authoriser cannot write it — and
 * it must not, because that row is what the recipient later revises. The
 * authoriser therefore leaves the signed record here, the recipient reads it,
 * verifies the signature, and publishes it under its own account. The server
 * only relays; it can no more manufacture an authorisation than it could before.
 *
 * One row per device, newest revision winning, so a repeated approval replaces
 * its predecessor rather than accumulating.
 */
export const albumEnrollmentOffers = sqliteTable(
  'album_enrollment_offers',
  {
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    revision: integer('revision').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.deviceId] })]
);

// ── User Preferences ───────────────────────────────────────────────────────

export const userPreferences = sqliteTable(
  'user_preferences',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    themeId: text('theme_id').notNull().default('sunset-shore'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (table) => [
    check(
      'ck_user_preferences_theme_id',
      sql`${table.themeId} in ('sunset-shore', 'sea-glass', 'deep-ocean')`
    ),
  ]
);

// ── Space Plus Entitlements (P8A) ───────────────────────────────────────────
// One row per Space, keyed by space. Authority for Space-level Plus: both
// active members observe this same row. Never written from client state —
// only the RevenueCat webhook program mutates it.
// - purchaserUserId: the RevenueCat app_user_id (== Aoi user id) that paid.
// - expiresAt: end of the paid period from the provider (null = open-ended).
//   Read-time liveness is `status = 'active' AND (expiresAt IS NULL OR
//   expiresAt > now)` — expiry needs no cron and no further events.
// - lastEventId/lastEventAtMs: provider watermark. A delivery applies only
//   when (event_timestamp_ms, id) is strictly newer, so retries are no-ops
//   and stale out-of-order events can never regress the row.

export const spacePlusEntitlements = sqliteTable(
  'space_plus_entitlements',
  {
    spaceId: text('space_id')
      .primaryKey()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    purchaserUserId: text('purchaser_user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull().default('revenuecat'),
    entitlementId: text('entitlement_id').notNull(),
    productId: text('product_id'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    status: text('status').notNull().default('active'),
    lastEventId: text('last_event_id').notNull(),
    lastEventAtMs: integer('last_event_at_ms').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
  },
  (table) => [
    index('idx_space_plus_purchaser').on(table.purchaserUserId),
    check('ck_space_plus_status', sql`${table.status} in ('active', 'inactive')`),
  ]
);

// ── Processed Webhook Events (P8A) ─────────────────────────────────────────
// Exact delivery idempotency for the RevenueCat webhook: one row per provider
// event id. A redelivery hits this table first and is a no-op regardless of
// any state the first delivery left behind. Rows older than the retention
// window are pruned on every webhook (bounded storage; the provider retry
// schedule spans hours, retention spans weeks).

export const WEBHOOK_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const processedWebhookEvents = sqliteTable('processed_webhook_events', {
  eventId: text('event_id').primaryKey(),
  receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
});

export const momentResponses = sqliteTable('moment_responses', {
  id: text('id').primaryKey(),
  momentId: text('moment_id').notNull().references(() => moments.id, { onDelete: 'cascade' }),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id),
  kind: text('kind', { enum: ['tap', 'photo', 'voice', 'word'] }).notNull(),
  body: text('body'),
  mediaId: text('media_id').references(() => mediaObjects.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  index('idx_moment_responses_moment_created').on(table.momentId, table.createdAt, table.id),
  index('idx_moment_responses_media').on(table.mediaId),
  check('ck_moment_response_payload', sql`
    (${table.kind} = 'tap' and ${table.body} is null and ${table.mediaId} is null)
    or (${table.kind} = 'word' and ${table.body} is not null and length(trim(${table.body})) between 1 and 400 and ${table.mediaId} is null)
    or (${table.kind} in ('photo', 'voice') and ${table.body} is null and ${table.mediaId} is not null)`),
]);

export const partnerDetails = sqliteTable('partner_details', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  category: text('category', { enum: ['favorite', 'habit', 'quirk', 'words', 'other'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  index('idx_partner_details_user_created').on(table.userId, table.createdAt, table.id),
  check('ck_partner_detail_text', sql`length(trim(${table.text})) between 1 and 400`),
  check('ck_partner_detail_category', sql`${table.category} in ('favorite', 'habit', 'quirk', 'words', 'other')`),
]);
