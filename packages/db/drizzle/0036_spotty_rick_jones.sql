-- #2887: What the page's author left for the Artifact Session. That session
-- cannot see the conversation the page was commissioned in — it starts cold
-- and is handed the request, plus the page's source on the first ask — so an
-- agent publishing a page with a job to do has to plan for its own amnesia.
-- The brief is prepended to every request prompt, which is also why it is
-- capped: it is charged to every turn the page ever causes.
-- Nullable, and replaceable without publishing a version: a version bump
-- reloads the frame and would destroy the state the brief exists to serve.

ALTER TABLE "library_artifacts" ADD COLUMN "brief" text;
