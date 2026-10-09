CREATE TABLE `album_media_reservations` (
	`space_id` text NOT NULL,
	`media_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`uploader_device_id` text NOT NULL,
	`generation` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`completed_etag` text,
	`completed_size` integer,
	PRIMARY KEY(`space_id`, `media_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_album_media_reservations_state" CHECK("album_media_reservations"."state" in ('pending', 'complete', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_album_media_reservations_state` ON `album_media_reservations` (`space_id`,`state`);