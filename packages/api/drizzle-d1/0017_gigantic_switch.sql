CREATE TABLE `album_device_records` (
	`space_id` text NOT NULL,
	`device_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`revision` integer NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`space_id`, `device_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_album_device_records_owner` ON `album_device_records` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `album_device_tombstones` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`target_device_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_album_device_tombstones_target` ON `album_device_tombstones` (`space_id`,`target_device_id`);--> statement-breakpoint
CREATE TABLE `album_recovery_envelopes` (
	`space_id` text NOT NULL,
	`generation` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`space_id`, `generation`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `album_space_key_envelopes` (
	`space_id` text NOT NULL,
	`generation` integer NOT NULL,
	`recipient_device_id` text NOT NULL,
	`recipient_revision` integer NOT NULL,
	`authoriser_device_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`space_id`, `generation`, `recipient_device_id`, `recipient_revision`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `album_trust_anchors` (
	`space_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
