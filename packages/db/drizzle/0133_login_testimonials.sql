-- The quotes the login page shows from users of the install, in order, so an
-- operator changes them without a redeploy. A photo is an avatar_images id; the
-- avatar sweep keeps every id named here.
CREATE TABLE "login_testimonials" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"quote" text NOT NULL,
	"photo_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "login_testimonials_position_idx" ON "login_testimonials" USING btree ("position");