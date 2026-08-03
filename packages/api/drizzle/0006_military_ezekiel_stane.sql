CREATE TABLE "weekly_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"week_key" text NOT NULL,
	"question_id" integer NOT NULL,
	"answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weekly_answers" ADD CONSTRAINT "weekly_answers_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_answers" ADD CONSTRAINT "weekly_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_weekly_answers_space_user_week" ON "weekly_answers" USING btree ("space_id","user_id","week_key");--> statement-breakpoint
CREATE INDEX "idx_weekly_answers_space_week" ON "weekly_answers" USING btree ("space_id","week_key");