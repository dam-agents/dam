-- Sidebar pins: the Agents a user pinned to the top of the sidebar, and the
-- Sessions pinned to the top of each Agent's list, in the order the user
-- dragged them into. Kept per user so the order follows them to every
-- browser. A pin goes away with its Agent.
CREATE TABLE "sidebar_agent_pins" (
	"owner" text NOT NULL,
	"agent_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "sidebar_agent_pins_owner_agent_id_pk" PRIMARY KEY("owner","agent_id")
);
--> statement-breakpoint
CREATE TABLE "sidebar_session_pins" (
	"owner" text NOT NULL,
	"agent_id" text NOT NULL,
	"session_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "sidebar_session_pins_owner_agent_id_session_id_pk" PRIMARY KEY("owner","agent_id","session_id")
);
--> statement-breakpoint
CREATE INDEX "sidebar_agent_pins_agent_idx" ON "sidebar_agent_pins" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "sidebar_session_pins_agent_idx" ON "sidebar_session_pins" USING btree ("agent_id");