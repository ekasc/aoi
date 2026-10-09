CREATE TABLE `album_device_claims` (
	`space_id` text NOT NULL,
	`device_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`signing_public_key` text NOT NULL,
	`agreement_public_key` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`space_id`, `device_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_album_space_key_envelopes` (
	`space_id` text NOT NULL,
	`generation` integer NOT NULL,
	`recipient_device_id` text NOT NULL,
	`recipient_revision` integer NOT NULL,
	`authoriser_device_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`space_id`, `generation`, `recipient_device_id`, `recipient_revision`, `authoriser_device_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_album_space_key_envelopes`("space_id", "generation", "recipient_device_id", "recipient_revision", "authoriser_device_id", "payload", "created_at") SELECT "space_id", "generation", "recipient_device_id", "recipient_revision", "authoriser_device_id", "payload", "created_at" FROM `album_space_key_envelopes`;--> statement-breakpoint
DROP TABLE `album_space_key_envelopes`;--> statement-breakpoint
ALTER TABLE `__new_album_space_key_envelopes` RENAME TO `album_space_key_envelopes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_album_device_tombstones_payload` ON `album_device_tombstones` (`space_id`,`payload`);