CREATE TABLE `album_media_manifests` (
	`space_id` text NOT NULL,
	`media_id` text NOT NULL,
	`uploader_device_id` text NOT NULL,
	`revision` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`space_id`, `media_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `album_media_tombstones` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`media_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_album_media_tombstones_media` ON `album_media_tombstones` (`space_id`,`media_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_album_media_tombstones_payload` ON `album_media_tombstones` (`space_id`,`payload`);