CREATE TABLE "resource_alerts" (
	"owner_sub" text NOT NULL,
	"kind" text NOT NULL,
	"level" text NOT NULL,
	"notified_level" text,
	"notified_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_alerts_owner_sub_kind_pk" PRIMARY KEY("owner_sub","kind")
);
