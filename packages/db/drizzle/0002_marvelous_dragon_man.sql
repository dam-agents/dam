CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_sub" text NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"agent_ids" text[],
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "api_keys_owner_idx" ON "api_keys" USING btree ("owner_sub") WHERE "api_keys"."revoked_at" IS NULL;