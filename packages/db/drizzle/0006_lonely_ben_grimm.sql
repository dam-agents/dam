CREATE TABLE "run_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "run_artifacts_key_idx" ON "run_artifacts" USING btree ("key");