-- Skills created in the sandbox and skills baked into the image both live only
-- on the pod's disk, so a stopped sandbox reported an empty standalone list and
-- the UI could not tell "no skills" from "the list is on an offline pod". This
-- records that list while the sandbox runs. Null means nothing was ever
-- recorded, which is what keeps a never-run sandbox distinguishable from one
-- that genuinely has no standalone skills.
ALTER TABLE "agents" ADD COLUMN "skills_snapshot" jsonb;
