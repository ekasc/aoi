CREATE TABLE "space_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_space_activity_kind" CHECK ("space_activity"."kind" in ('moment_deleted', 'moment_edited'))
);
--> statement-breakpoint
ALTER TABLE "space_activity" ADD CONSTRAINT "space_activity_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_activity" ADD CONSTRAINT "space_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_space_activity_space_occurred" ON "space_activity" USING btree ("space_id","occurred_at");
