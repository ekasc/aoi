PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_album_media_reservations` (
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
	CONSTRAINT "ck_album_media_reservations_state" CHECK("__new_album_media_reservations"."state" in ('pending', 'expiring', 'complete', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_album_media_reservations`("space_id", "media_id", "created_by_user_id", "uploader_device_id", "generation", "byte_length", "state", "created_at", "expires_at", "completed_at", "completed_etag", "completed_size") SELECT "space_id", "media_id", "created_by_user_id", "uploader_device_id", "generation", "byte_length", "state", "created_at", "expires_at", "completed_at", "completed_etag", "completed_size" FROM `album_media_reservations`;--> statement-breakpoint
DROP TABLE `album_media_reservations`;--> statement-breakpoint
ALTER TABLE `__new_album_media_reservations` RENAME TO `album_media_reservations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_album_media_reservations_state` ON `album_media_reservations` (`space_id`,`state`);