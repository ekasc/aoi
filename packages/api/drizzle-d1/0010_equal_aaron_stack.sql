CREATE TABLE `moment_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`moment_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text,
	`media_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`moment_id`) REFERENCES `moments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_id`) REFERENCES `media_objects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_moment_response_payload" CHECK(
    ("moment_responses"."kind" = 'tap' and "moment_responses"."body" is null and "moment_responses"."media_id" is null)
    or ("moment_responses"."kind" = 'word' and "moment_responses"."body" is not null and length(trim("moment_responses"."body")) between 1 and 400 and "moment_responses"."media_id" is null)
    or ("moment_responses"."kind" in ('photo', 'voice') and "moment_responses"."body" is null and "moment_responses"."media_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `idx_moment_responses_moment_created` ON `moment_responses` (`moment_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_moment_responses_media` ON `moment_responses` (`media_id`);--> statement-breakpoint
CREATE TABLE `partner_details` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`text` text NOT NULL,
	`category` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_partner_detail_text" CHECK(length(trim("partner_details"."text")) between 1 and 400),
	CONSTRAINT "ck_partner_detail_category" CHECK("partner_details"."category" in ('favorite', 'habit', 'quirk', 'words', 'other'))
);
--> statement-breakpoint
CREATE INDEX `idx_partner_details_user_created` ON `partner_details` (`user_id`,`created_at`,`id`);