-- An agent may hold several GitHub accounts on one host. The preferred grant is
-- the account it acts as until it switches itself; at most one per agent and
-- host is kept preferred by the Connections service.
ALTER TABLE "connection_grants" ADD COLUMN "preferred" boolean DEFAULT false NOT NULL;