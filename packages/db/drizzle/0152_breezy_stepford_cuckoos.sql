-- When an Agent first met an image its Template offers and it does not run, so
-- the forced move counts from the image's arrival and not from anything that
-- resets. It holds the target image and the time, since a stamp for a target
-- the Template has since left counts for nothing. Null until an Agent goes
-- out of date.
ALTER TABLE "control"."agents" ADD COLUMN "image_outdated" text;
