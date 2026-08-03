ALTER TABLE "calendar_events" ADD COLUMN "reminder_minutes_before" jsonb;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "all_day" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "together" boolean DEFAULT false NOT NULL;
