-- A grant can name the credential it uses in place of its Connection's own:
-- an API key that belongs to one Agent, for the platform Connection. The
-- credential's value lives in its own Secret; this table says which Connection
-- it serves and where that Secret is. No backfill: a grant with no credential
-- uses its Connection's own, as before. The foreign key from the grant takes
-- no action on delete, so a credential still named by a grant cannot be
-- dropped, and a grant never silently goes back to the wider credential.
CREATE TABLE "connection_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"owner" text NOT NULL,
	"secret_ref" jsonb NOT NULL,
	"inputs" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connection_grants" ADD COLUMN "credential_id" text;--> statement-breakpoint
ALTER TABLE "connection_credentials" ADD CONSTRAINT "connection_credentials_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connection_credentials_connection_idx" ON "connection_credentials" USING btree ("connection_id");--> statement-breakpoint
ALTER TABLE "connection_grants" ADD CONSTRAINT "connection_grants_credential_id_connection_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."connection_credentials"("id") ON DELETE no action ON UPDATE no action;