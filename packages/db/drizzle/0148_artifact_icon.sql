-- An artifact carries the icon its Agent picked, shown as the favicon of
-- its browser tab; artifacts published before have none.
ALTER TABLE "library_artifacts" ADD COLUMN "icon" text;
