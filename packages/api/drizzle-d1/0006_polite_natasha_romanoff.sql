ALTER TABLE `space_invites` ADD `revoked_at` integer;--> statement-breakpoint
ALTER TABLE `spaces` ADD `partner_user_id` text;--> statement-breakpoint
-- Backfill pairing bindings for spaces that already have partner history:
-- the earliest partner member (active or left) owns the binding. Spaces
-- with no partner row stay unbound (first future join binds them).
UPDATE `spaces` SET `partner_user_id` = (
  SELECT `user_id` FROM `space_members`
  WHERE `space_id` = `spaces`.`id` AND `role` = 'partner'
  ORDER BY `joined_at` ASC, `user_id` ASC LIMIT 1
) WHERE EXISTS (
  SELECT 1 FROM `space_members`
  WHERE `space_id` = `spaces`.`id` AND `role` = 'partner'
);