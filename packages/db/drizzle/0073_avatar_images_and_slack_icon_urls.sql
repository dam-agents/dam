CREATE TABLE "avatar_images" (
	"id" text PRIMARY KEY NOT NULL,
	"png" "bytea" NOT NULL,
	"owner_sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_icon_urls" (
	"hash" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
