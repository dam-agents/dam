-- Who publishes a catalog kit: the platform team, or the user a catalog entry
-- names. The catalog's own reviewers write it in catalog.yaml, never the kit,
-- and the refresh stores it resolved. A row written before this column has none
-- and reads as the team's until the next refresh rewrites it.
ALTER TABLE "starter_kit_catalog_entries" ADD COLUMN "publisher" jsonb;
