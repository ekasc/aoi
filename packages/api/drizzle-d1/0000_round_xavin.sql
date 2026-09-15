CREATE TABLE `auth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_auth_accounts_provider_account` ON `auth_accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `idx_auth_accounts_user` ON `auth_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`actor` text NOT NULL,
	`actor_name` text NOT NULL,
	`title` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`label_preset` text NOT NULL,
	`label_custom_text` text,
	`reminder_minutes_before` text,
	`all_day` integer DEFAULT false NOT NULL,
	`together` integer DEFAULT false NOT NULL,
	`recurrence` text DEFAULT 'none' NOT NULL,
	`recurrence_group_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_calendar_events_actor" CHECK("calendar_events"."actor" in ('you', 'partner')),
	CONSTRAINT "ck_calendar_events_label_preset" CHECK("calendar_events"."label_preset" in ('Work', 'Gym', 'Travel', 'Date', 'Family', 'Other')),
	CONSTRAINT "ck_calendar_events_recurrence" CHECK("calendar_events"."recurrence" in ('none', 'weekly'))
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_events_space_starts` ON `calendar_events` (`space_id`,`starts_at`) WHERE "calendar_events"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `idx_calendar_events_owner` ON `calendar_events` (`created_by_user_id`,`id`) WHERE "calendar_events"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `event_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`proposer_user_id` text NOT NULL,
	`title` text NOT NULL,
	`proposed_start` integer NOT NULL,
	`proposed_end` integer NOT NULL,
	`label` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_event_proposals_status" CHECK("event_proposals"."status" in ('pending', 'accepted', 'declined'))
);
--> statement-breakpoint
CREATE INDEX `idx_event_proposals_space_status` ON `event_proposals` (`space_id`,`status`);--> statement-breakpoint
CREATE TABLE `imported_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`occurred_at` integer NOT NULL,
	`target_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_imported_milestones_type" CHECK("imported_milestones"."type" in ('note', 'milestone', 'date', 'goal'))
);
--> statement-breakpoint
CREATE INDEX `idx_imported_milestones_space_occurred` ON `imported_milestones` (`space_id`,`occurred_at`) WHERE "imported_milestones"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `letters` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`caption` text,
	`body` text NOT NULL,
	`sealed_until` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`opened_at` integer,
	`opened_by_user_id` text,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_letters_space_sealed_until` ON `letters` (`space_id`,`sealed_until`);--> statement-breakpoint
CREATE TABLE `location_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`space_id` text NOT NULL,
	`mode` text NOT NULL,
	`destination` text,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`accuracy_meters` real,
	`reported_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_location_shares_mode" CHECK("location_shares"."mode" in ('live', 'until_arrive', 'on_request_granted')),
	CONSTRAINT "ck_location_shares_latitude" CHECK("location_shares"."latitude" between -90 and 90),
	CONSTRAINT "ck_location_shares_longitude" CHECK("location_shares"."longitude" between -180 and 180)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_shares_user_id_unique` ON `location_shares` (`user_id`);--> statement-breakpoint
CREATE TABLE `media_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`storage_key` text NOT NULL,
	`upload_state` text DEFAULT 'pending' NOT NULL,
	`content_hash` text,
	`variant_keys` text,
	`processing_attempts` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`encryption_scheme` text,
	`encryption_meta` text,
	`client_sha256` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_media_objects_upload_state" CHECK("media_objects"."upload_state" in ('pending', 'complete', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_objects_storage_key_unique` ON `media_objects` (`storage_key`);--> statement-breakpoint
CREATE INDEX `idx_media_objects_space` ON `media_objects` (`space_id`);--> statement-breakpoint
CREATE TABLE `moments` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`author_role` text NOT NULL,
	`author_name` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`occurred_at` integer NOT NULL,
	`target_at` integer,
	`media_preview` text,
	`audio_uri` text,
	`client_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_moments_type" CHECK("moments"."type" in ('note', 'milestone', 'date', 'goal', 'media', 'trace')),
	CONSTRAINT "ck_moments_author_role" CHECK("moments"."author_role" in ('you', 'partner'))
);
--> statement-breakpoint
CREATE INDEX `idx_moments_space_occurred_id` ON `moments` (`space_id`,`occurred_at`,`id`) WHERE "moments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `idx_moments_owner` ON `moments` (`created_by_user_id`,`id`) WHERE "moments"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_moments_space_client_id` ON `moments` (`space_id`,`client_id`) WHERE "moments"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_states_identifier` ON `oauth_states` (`identifier`);--> statement-breakpoint
CREATE TABLE `push_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expo_push_token` text NOT NULL,
	`platform` text DEFAULT 'unknown' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_push_tokens_platform" CHECK("push_tokens"."platform" in ('ios', 'android', 'web', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_tokens_expo_push_token_unique` ON `push_tokens` (`expo_push_token`);--> statement-breakpoint
CREATE INDEX `idx_push_tokens_user` ON `push_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `someday_items` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`category` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`checked_at` integer,
	`checked_by_user_id` text,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_someday_items_category" CHECK("someday_items"."category" in ('place', 'food', 'film', 'other'))
);
--> statement-breakpoint
CREATE INDEX `idx_someday_items_space` ON `someday_items` (`space_id`);--> statement-breakpoint
CREATE TABLE `space_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text,
	`occurred_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_space_activity_kind" CHECK("space_activity"."kind" in ('moment_deleted', 'moment_edited'))
);
--> statement-breakpoint
CREATE INDEX `idx_space_activity_space_occurred` ON `space_activity` (`space_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `space_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`code` text NOT NULL,
	`code_normalized` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`expires_at` integer,
	`redeemed_by_user_id` text,
	`redeemed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`redeemed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_space_invites_code_normalized` ON `space_invites` (`code_normalized`);--> statement-breakpoint
CREATE TABLE `space_members` (
	`space_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`left_at` integer,
	`location_consent_at` integer,
	PRIMARY KEY(`space_id`, `user_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_space_members_role" CHECK("space_members"."role" in ('you', 'partner')),
	CONSTRAINT "ck_space_members_state" CHECK("space_members"."state" in ('active', 'left'))
);
--> statement-breakpoint
CREATE INDEX `idx_space_members_user_state` ON `space_members` (`user_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_space_members_user_active` ON `space_members` (`user_id`) WHERE "space_members"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `uq_space_members_space_partner_active` ON `space_members` (`space_id`) WHERE "space_members"."state" = 'active' and "space_members"."role" = 'partner';--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`partner_name` text,
	`relationship_start_date` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme_id` text DEFAULT 'sunset-shore' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_user_preferences_theme_id" CHECK("user_preferences"."theme_id" in ('sunset-shore', 'sea-glass', 'deep-ocean'))
);
--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_sessions_token_unique` ON `user_sessions` (`token`);--> statement-breakpoint
CREATE INDEX `idx_user_sessions_user` ON `user_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`name` text NOT NULL,
	`image` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `weekly_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`user_id` text NOT NULL,
	`week_key` text NOT NULL,
	`question_id` integer NOT NULL,
	`answer` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_weekly_answers_space_user_week` ON `weekly_answers` (`space_id`,`user_id`,`week_key`);--> statement-breakpoint
CREATE INDEX `idx_weekly_answers_space_week` ON `weekly_answers` (`space_id`,`week_key`);