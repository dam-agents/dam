-- Interactive artifacts are on for every user, so the saved per-user choice has no reader.
DELETE FROM "user_features" WHERE "feature" = 'interactive-artifacts';
