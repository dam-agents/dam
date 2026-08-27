-- #2887: Marks an artifact whose page may ask its agent to do something. An
-- agent runs with its owner's credentials and connections, so a page anyone
-- could open must never be able to drive it: an interactive artifact is
-- refused a share link and stays private for its whole life.
-- Written only at create, like `kind`. A share link outlives every revision,
-- so a flag a revision could flip would let a URL vetted while it served an
-- inert page later serve one that calls back.

ALTER TABLE "library_artifacts" ADD COLUMN "interactive" boolean DEFAULT false NOT NULL;
