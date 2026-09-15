CREATE TABLE `moment_reads` (
	`moment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`space_id` text NOT NULL,
	`read_at` integer NOT NULL,
	PRIMARY KEY(`moment_id`, `user_id`),
	FOREIGN KEY (`moment_id`) REFERENCES `moments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_moment_reads_user_space` ON `moment_reads` (`user_id`,`space_id`);
