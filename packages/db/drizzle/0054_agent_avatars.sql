-- Agent avatars. The avatar is a seed the UI turns into a procedural robot
-- head. Only the api-server reads and writes it, so it lives in Postgres, not
-- on the Agent CR. An Agent with no row falls back to its own ID as the seed.
CREATE TABLE "agent_avatars" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"seed" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
