PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`partner_name` text,
	`relationship_start_date` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_spaces`("id", "name", "partner_name", "relationship_start_date", "created_by_user_id", "created_at", "updated_at", "archived_at") SELECT "id", "name", "partner_name", "relationship_start_date", "created_by_user_id", "created_at", "updated_at", "archived_at" FROM `spaces`;--> statement-breakpoint
DROP TABLE `spaces`;--> statement-breakpoint
ALTER TABLE `__new_spaces` RENAME TO `spaces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;