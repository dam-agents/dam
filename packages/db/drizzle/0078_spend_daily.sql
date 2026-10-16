-- Metered Spend: the gateway of each agent measures every model call, and the
-- api-server prices it when the record arrives. This table keeps the result
-- per UTC day, payer agent (the root driver), Connection and model, so that a
-- later price change never rewrites history or a limit. The cost is in micro-
-- units of the Connection's unit. A row has no foreign key to the agent: the
-- spend of a deleted agent still counts for its owner on that day.
CREATE TABLE "spend_daily" (
	"day" date NOT NULL,
	"payer_agent_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"model" text NOT NULL,
	"owner_sub" text NOT NULL,
	"provider_template" text NOT NULL,
	"unit" text NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"uncached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_5m_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_1h_tokens" bigint DEFAULT 0 NOT NULL,
	"web_searches" integer DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"estimated_calls" integer DEFAULT 0 NOT NULL,
	"refused_calls" integer DEFAULT 0 NOT NULL,
	"max_call_cost_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spend_daily_day_payer_agent_id_connection_id_model_pk" PRIMARY KEY("day","payer_agent_id","connection_id","model")
);
--> statement-breakpoint
CREATE INDEX "spend_daily_owner_day_idx" ON "spend_daily" USING btree ("owner_sub","day");