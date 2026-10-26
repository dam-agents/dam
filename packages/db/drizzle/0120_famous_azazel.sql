CREATE TABLE "profile_defaults" (
	"owner" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_defaults" ADD CONSTRAINT "profile_defaults_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;