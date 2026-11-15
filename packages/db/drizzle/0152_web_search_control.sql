-- Web search control, per agent. `control.agents.web_search_control` is the
-- owner's switch: the controller reads it and renders the agent's gateway so
-- every model call's body reaches the ext_authz check, which holds a Messages
-- call that declares a native web search tool. `web_search_rules` is the
-- agent's one remembered answer to such a hold, allow or deny. It is kept apart
-- from egress rules on purpose: a rule that allows every host must not allow
-- web search, and the agent writes the query, so no rule may name one.
CREATE TABLE "web_search_rules" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"verdict" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_search_rules_verdict" CHECK ("web_search_rules"."verdict" IN ('allow', 'deny'))
);
--> statement-breakpoint
ALTER TABLE "control"."agents" ADD COLUMN "web_search_control" boolean DEFAULT false NOT NULL;