-- A sub-agent can run a script instead of a prompt. Its row keeps the script,
-- the exit code and the size and hash of the stdout and stderr blobs it left in
-- the object store; a script run has no result schema. output_expires_at is
-- when uncollected blobs are deleted.

ALTER TABLE "invocations" ALTER COLUMN "result_schema" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "script" text;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "exit_code" integer;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "output" jsonb;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "output_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "invocations_output_expiry_idx" ON "invocations" USING btree ("output_expires_at") WHERE "invocations"."output_expires_at" IS NOT NULL;