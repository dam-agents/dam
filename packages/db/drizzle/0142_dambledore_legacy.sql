-- Whether the account was here before the platform gave it the assistant, which is
-- what decides who the CurveBender notice is for: an account onboarded with the
-- assistant never sees it.
-- From this release on it is written once, when the platform first makes the
-- assistant for a person, and never recomputed — deleting the assistant, making a
-- new one, or deleting the last older Agent does not move anyone between the two.
-- Every row that exists at upgrade time is marked legacy, which is the safe
-- default: showing the notice is a nuisance, withholding it from someone who was
-- here first loses what the notice exists for. Those rows exist only where #6387
-- ran before this change, which is dev — a release install gets both in one go, so
-- its table is empty and every row it ever writes is judged by the create itself.
-- This was first written as a reconstruction from the Agents' own start times; that
-- read `public.agents`, the usage mirror, whose owner is pseudonymized, so it could
-- never have matched, and its "created before" rule would have re-judged an account
-- on every upgrade.
ALTER TABLE "dambledore_provisioned" ADD COLUMN "legacy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "dambledore_provisioned" SET "legacy" = true;
