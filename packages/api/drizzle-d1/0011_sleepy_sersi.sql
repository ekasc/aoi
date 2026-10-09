CREATE TABLE `album_backups` (
	`space_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `album_media` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_length` integer NOT NULL,
	`width` integer,
	`height` integer,
	`person_tag` text,
	`sealed_nonce` text NOT NULL,
	`wrapped_key_nonce` text NOT NULL,
	`wrapped_key_ciphertext` text NOT NULL,
	`storage_key` text NOT NULL,
	`upload_state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_album_media_upload_state" CHECK("album_media"."upload_state" in ('pending', 'complete', 'failed')),
	CONSTRAINT "ck_album_media_person_tag" CHECK("album_media"."person_tag" is null or "album_media"."person_tag" in ('you', 'partner'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `album_media_storage_key_unique` ON `album_media` (`storage_key`);--> statement-breakpoint
CREATE INDEX `idx_album_media_space` ON `album_media` (`space_id`);