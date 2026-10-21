CREATE TABLE "environments" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"owning_agent_id" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"endpoints" jsonb NOT NULL,
	"access" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "environments_owning_agent_idx" ON "environments" USING btree ("owning_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_host_idx" ON "environments" USING btree ("host");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_owning_agent_name_idx" ON "environments" USING btree ("owning_agent_id","name");--> statement-breakpoint
CREATE INDEX "environments_expires_at_idx" ON "environments" USING btree ("expires_at");