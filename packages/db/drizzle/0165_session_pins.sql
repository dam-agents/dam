CREATE TABLE "session_pins" (
	"owner" text NOT NULL,
	"agent_id" text NOT NULL,
	"session_id" text NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_pins_owner_agent_id_session_id_pk" PRIMARY KEY("owner","agent_id","session_id")
);
--> statement-breakpoint
CREATE INDEX "session_pins_agent_idx" ON "session_pins" USING btree ("agent_id","session_id");