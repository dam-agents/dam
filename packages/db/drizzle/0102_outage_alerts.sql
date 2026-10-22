-- One row per owner and Connection template: whether the owner was told that
-- an outage hits their agents, or that it ended. The compare-and-set on
-- version stops two evaluations from sending the same message twice.
CREATE TABLE "outage_alerts" (
	"owner_sub" text NOT NULL,
	"template_id" text NOT NULL,
	"state" text NOT NULL,
	"reason" text NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"told_at" timestamp with time zone NOT NULL,
	"recovered_at" timestamp with time zone,
	"agents" jsonb NOT NULL,
	"status_page_url" text,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outage_alerts_owner_sub_template_id_pk" PRIMARY KEY("owner_sub","template_id")
);
