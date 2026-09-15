CREATE TABLE `moment_attachments` (
	`moment_id` text NOT NULL,
	`media_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`moment_id`, `media_id`),
	FOREIGN KEY (`moment_id`) REFERENCES `moments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_moment_attachments_kind" CHECK("moment_attachments"."kind" in ('image', 'audio')),
	CONSTRAINT "ck_moment_attachments_position" CHECK("moment_attachments"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_moment_attachments_moment_position` ON `moment_attachments` (`moment_id`,`position`);--> statement-breakpoint
-- Backfill pre-attachment single-media moments so new clients see old
-- photos via `attachments` while old clients keep the legacy columns.
-- Only live, complete media (pending/failed/deleted rows stay legacy-only;
-- purged media has no row to join and stays degraded via the legacy id).
INSERT INTO `moment_attachments` (`moment_id`, `media_id`, `position`, `kind`)
SELECT m.`id`, m.`media_id`, 0,
  CASE WHEN mo.`mime_type` LIKE 'audio/%' THEN 'audio' ELSE 'image' END
FROM `moments` m
JOIN `media_objects` mo ON mo.`id` = m.`media_id`
  AND mo.`deleted_at` IS NULL
  AND mo.`upload_state` = 'complete'
WHERE m.`media_id` IS NOT NULL;
