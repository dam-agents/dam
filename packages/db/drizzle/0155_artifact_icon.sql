-- An artifact carries an icon, one emoji, shown in the library and as the
-- favicon of its browser tab; artifacts published before have none.
ALTER TABLE "library_artifacts" ADD COLUMN "icon" text;
