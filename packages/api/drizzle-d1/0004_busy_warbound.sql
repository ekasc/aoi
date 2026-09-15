CREATE TABLE `space_plus_entitlements` (
	`space_id` text PRIMARY KEY NOT NULL,
	`purchaser_user_id` text NOT NULL,
	`provider` text DEFAULT 'revenuecat' NOT NULL,
	`entitlement_id` text NOT NULL,
	`product_id` text,
	`expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`last_event_id` text NOT NULL,
	`last_event_at_ms` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchaser_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_space_plus_status" CHECK("space_plus_entitlements"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE INDEX `idx_space_plus_purchaser` ON `space_plus_entitlements` (`purchaser_user_id`);