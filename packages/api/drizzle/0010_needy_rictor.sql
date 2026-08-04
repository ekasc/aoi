CREATE TABLE "event_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"proposer_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"proposed_start" timestamp with time zone NOT NULL,
	"proposed_end" timestamp with time zone NOT NULL,
	"label" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "ck_event_proposals_status" CHECK ("event_proposals"."status" in ('pending', 'accepted', 'declined'))
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "recurrence" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "recurrence_group_id" uuid;--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_proposer_user_id_users_id_fk" FOREIGN KEY ("proposer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_event_proposals_space_status" ON "event_proposals" USING btree ("space_id","status");