DROP INDEX IF EXISTS `uq_moments_space_client_id`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_moments_space_user_client_id` ON `moments` (`space_id`,`created_by_user_id`,`client_id`) WHERE "moments"."deleted_at" is null;--> statement-breakpoint
