-- The platform no longer gives an owner an automatic "Default" profile: a new
-- agent without an owner-chosen default starts on the base default instead.
-- An owner whose default for new agents is the seeded profile never chose it,
-- so the mark goes and the profile stays as an ordinary one. Runs before the
-- next migration drops profiles.seed, the column that tells them apart.
DELETE FROM "profile_defaults" d
USING "profiles" p
WHERE d."profile_id" = p."id" AND p."seed" IS NOT NULL;
