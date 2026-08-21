-- #3135: The Public Agent Page is served to visitors with no login, so it must
-- not read agent names from the K8s API — ids are unguessable, so every URL is
-- a distinct cache key and public traffic would reach the control plane on
-- every view. This table is the projection the page reads instead. Rows are
-- filled lazily on first view, kept current by the agent-event saga, and
-- refreshed by a periodic reconcile.
-- owner_sub holds the real Keycloak sub, NOT a pseudonym. The neighbouring
-- `agents` table hashes its owner_sub because it belongs to usage tracking,
-- whose premise is pseudonymized identifiers. Here the sub must be resolvable
-- back to an email so the page can name the agent's owner, exactly as
-- channels.owner already does.

CREATE TABLE "agent_public_profiles" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_sub" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
