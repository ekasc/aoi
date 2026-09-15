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

// ── Imported Milestones ────────────────────────────────────────────────────

export const importedMilestones = sqliteTable(
  'imported_milestones',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    targetAt: integer('target_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('idx_imported_milestones_space_occurred')
      .on(table.spaceId, table.occurredAt)
      .where(sql`${table.deletedAt} is null`),
    check(
      'ck_imported_milestones_type',
      sql`${table.type} in ('note', 'milestone', 'date', 'goal')`
    ),
  ]
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

// ── Event Proposals ────────────────────────────────────────────────────────

export const eventProposals = sqliteTable(
  'event_proposals',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    proposerUserId: text('proposer_user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    proposedStart: integer('proposed_start', { mode: 'timestamp_ms' }).notNull(),
    proposedEnd: integer('proposed_end', { mode: 'timestamp_ms' }).notNull(),
    label: text('label', { mode: 'json' }).$type<{ preset: string; customText?: string }>(),
    status: text('status').notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`).$defaultFn(() => new Date()),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('idx_event_proposals_space_status').on(table.spaceId, table.status),
    check(
      'ck_event_proposals_status',
      sql`${table.status} in ('pending', 'accepted', 'declined')`
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
