CREATE TABLE "provider_model_prices" (
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"row" jsonb NOT NULL,
	"free_search_quota" boolean DEFAULT false NOT NULL,
	"incomplete" text[] DEFAULT '{}' NOT NULL,
	"run_id" text NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "provider_model_prices_pk" PRIMARY KEY("provider","model")
);
--> statement-breakpoint
CREATE TABLE "provider_price_reads" (
	"connection_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_refused_at" timestamp with time zone,
	"last_status" integer,
	"model_count" integer DEFAULT 0 NOT NULL
);
