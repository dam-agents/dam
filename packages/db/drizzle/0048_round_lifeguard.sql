-- One certificate authority for the install rather than one per node: an
-- agent trusts the CA its node handed it and may be placed elsewhere
-- tomorrow, so the anchor cannot be a property of where it happens to run.
CREATE TABLE "install_secrets" (
	"name" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
