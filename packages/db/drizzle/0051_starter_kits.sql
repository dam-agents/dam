-- Starter kits (#3576, #3638). The resolved kit catalog: external catalogs
-- move -- adding a kit to one must not require redeploying the platform -- so a
-- periodic job re-reads every catalog, resolves each entry to a commit, and
-- writes the result here. That job is the only thing that reads the network;
-- every api-server serves kits from this table, which also gives a later Kit
-- Pull the provenance it needs to diff against. The agents column holds the
-- onboarding checklist a kit agent reports while its onboarding is pending:
-- the steps it declared through set_onboarding_checklist and which it has
-- ticked, written only through those MCP tools and read into the agent view.
CREATE TABLE "starter_kit_catalog_entries" (
	"catalog" text NOT NULL,
	"kit_id" text NOT NULL,
	"version" text NOT NULL,
	"source" text NOT NULL,
	"kit" jsonb NOT NULL,
	"bundled_skills" jsonb,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "starter_kit_catalog_entries_catalog_kit_id_pk" PRIMARY KEY("catalog","kit_id")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "onboarding_checklist" jsonb;