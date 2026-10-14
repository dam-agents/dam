-- Uploaded agent avatars (#4901): a 512 px PNG keyed by its SHA-256, served
-- publicly and uploaded to the Slack image host on demand.
CREATE TABLE "avatar_images" (
	"id" text PRIMARY KEY NOT NULL,
	"png" "bytea" NOT NULL,
	"owner_sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
