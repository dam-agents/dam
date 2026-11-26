CREATE TABLE "owner_request_mutes" (
	"owner_sub" text PRIMARY KEY NOT NULL,
	"muted_at" timestamp with time zone DEFAULT now() NOT NULL
);
