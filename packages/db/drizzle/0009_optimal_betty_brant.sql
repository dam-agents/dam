-- dam-2u6: the per-arm `arm_spec` jsonb was opaque config the platform never
-- interpreted — its only consumer JSON.stringify'd it into the trial prompt.
-- Replace it with `arm_variation` free text appended verbatim to the shared
-- prompt under an 'Arm variation:' header. Free text is a superset (users
-- wanting structure can still type YAML/JSON); structure becomes each harness
-- skill's contract, not a platform-imposed shape. Drop, not rename: jsonb→text
-- and the old blobs carry no meaning as text. Defaults to '' (optional, empty
-- allowed). In-design epic, no production data at stake.
ALTER TABLE "experiment_arms" ADD COLUMN "arm_variation" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "experiment_arms" DROP COLUMN "arm_spec";