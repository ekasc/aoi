CREATE TABLE "location_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"destination" jsonb,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_meters" double precision,
	"reported_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_shares_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "ck_location_shares_mode" CHECK ("location_shares"."mode" in ('live', 'until_arrive', 'on_request_granted')),
	CONSTRAINT "ck_location_shares_latitude" CHECK ("location_shares"."latitude" between -90 and 90),
	CONSTRAINT "ck_location_shares_longitude" CHECK ("location_shares"."longitude" between -180 and 180)
);
--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "location_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "location_shares" ADD CONSTRAINT "location_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_shares" ADD CONSTRAINT "location_shares_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;