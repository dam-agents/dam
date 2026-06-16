CREATE TABLE "agent_settings" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"model" text,
	"mode" text,
	"config_options" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
