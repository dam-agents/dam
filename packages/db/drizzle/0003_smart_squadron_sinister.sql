CREATE TABLE "agent_env" (
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "agent_env_agent_id_name_pk" PRIMARY KEY("agent_id","name")
);
--> statement-breakpoint
CREATE INDEX "agent_env_agent_idx" ON "agent_env" USING btree ("agent_id");