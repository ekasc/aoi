import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  uniqueIndex,
  index,
  check,
  primaryKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── Users ──────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ── Auth Accounts ──────────────────────────────────────────────────────────

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['apple', 'google'] }).notNull(),
    providerSubject: text('provider_subject').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_auth_accounts_provider_subject').on(table.provider, table.providerSubject),
  ]
);

// ── User Sessions ──────────────────────────────────────────────────────────

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_user_sessions_user_expires')
      .on(table.userId, table.expiresAt)
      .where(sql`${table.revokedAt} is null`),
  ]
);

// ── Spaces ─────────────────────────────────────────────────────────────────

export const spaces = pgTable('spaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  relationshipStartDate: date('relationship_start_date').notNull(),
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

// ── Space Members ──────────────────────────────────────────────────────────

export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['you', 'partner'] }).notNull(),
    state: text('state', { enum: ['active', 'left'] }).notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.userId] }),
    index('idx_space_members_user_state').on(table.userId, table.state),
  ]
);

// ── Space Invites ──────────────────────────────────────────────────────────

export const spaceInvites = pgTable(
  'space_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    codeNormalized: text('code_normalized').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    redeemedByUserId: uuid('redeemed_by_user_id').references(() => users.id),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_space_invites_code_normalized').on(table.codeNormalized),
  ]
);

// ── Imported Milestones ────────────────────────────────────────────────────

export const importedMilestones = pgTable(
  'imported_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    type: text('type', { enum: ['note', 'milestone', 'date', 'goal'] }).notNull(),
    title: text('title').notNull(),
    body: text('body'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    targetAt: timestamp('target_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_imported_milestones_space_occurred')
      .on(table.spaceId, table.occurredAt)
      .where(sql`${table.deletedAt} is null`),
  ]
);

// ── Moments ────────────────────────────────────────────────────────────────

export const moments = pgTable(
  'moments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    authorRole: text('author_role', { enum: ['you', 'partner'] }).notNull(),
    authorName: text('author_name').notNull(),
    type: text('type', { enum: ['note', 'milestone', 'date', 'goal', 'media'] }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    targetAt: timestamp('target_at', { withTimezone: true }),
    mediaPreview: text('media_preview'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_moments_space_occurred_id')
      .on(table.spaceId, table.occurredAt, table.id)
      .where(sql`${table.deletedAt} is null`),
    index('idx_moments_owner')
      .on(table.createdByUserId, table.id)
      .where(sql`${table.deletedAt} is null`),
  ]
);

// ── Calendar Events ────────────────────────────────────────────────────────

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    actor: text('actor', { enum: ['you', 'partner'] }).notNull(),
    actorName: text('actor_name').notNull(),
    title: text('title').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    labelPreset: text('label_preset', {
      enum: ['Work', 'Gym', 'Travel', 'Date', 'Family', 'Other'],
    }).notNull(),
    labelCustomText: text('label_custom_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_calendar_events_space_starts')
      .on(table.spaceId, table.startsAt)
      .where(sql`${table.deletedAt} is null`),
    index('idx_calendar_events_owner')
      .on(table.createdByUserId, table.id)
      .where(sql`${table.deletedAt} is null`),
  ]
);

// ── OAuth States ──────────────────────────────────────────────────────────

export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  provider: text('provider', { enum: ['apple', 'google'] }).notNull(),
  codeVerifier: text('code_verifier'),
  nonce: text('nonce'),
  redirectUri: text('redirect_uri').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Media Objects ──────────────────────────────────────────────────────────

export const mediaObjects = pgTable(
  'media_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: text('size_bytes').notNull(), // stored as text to handle large numbers
    storageKey: text('storage_key').notNull().unique(),
    uploadState: text('upload_state', { enum: ['pending', 'complete'] }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_media_objects_space').on(table.spaceId),
  ]
);

// ── User Preferences ───────────────────────────────────────────────────────

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  themeId: text('theme_id', { enum: ['sunset-shore', 'sea-glass', 'deep-ocean'] })
    .notNull()
    .default('sunset-shore'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
