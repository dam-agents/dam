CREATE TABLE "artifact_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"artifact_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"seq" integer NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "library_artifacts" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "artifact_requests" ADD CONSTRAINT "artifact_requests_artifact_id_library_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."library_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_requests_artifact_created_idx" ON "artifact_requests" USING btree ("artifact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_requests_artifact_seq_unique_idx" ON "artifact_requests" USING btree ("artifact_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_requests_in_flight_unique_idx" ON "artifact_requests" USING btree ("artifact_id") WHERE "artifact_requests"."state" in ('pending', 'delivered');