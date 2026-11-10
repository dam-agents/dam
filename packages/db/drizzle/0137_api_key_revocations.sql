CREATE TABLE "api_key_revocations" (
	"key_id" text PRIMARY KEY NOT NULL,
	"owner_sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_key_revocations_owner_idx" ON "api_key_revocations" USING btree ("owner_sub");