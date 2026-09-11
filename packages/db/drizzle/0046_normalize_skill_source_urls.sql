-- #3539: A repository has one identity but many written forms. Until now every
-- form was stored verbatim, so `http://`, a trailing slash, a `.git` suffix and
-- a pasted `/tree/<branch>/<dir>` URL each registered as a separate source and
-- only one of them scanned. New rows are normalized by
-- `normalizeGitUrl` (packages/agent-runtime-api) before they reach Postgres;
-- this migration rewrites the rows that were stored before that. Sources that
-- collapse onto one canonical URL are merged into the oldest row, and installed
-- refs follow them. The directory of a pasted `/tree/` URL becomes the source's
-- path when it has none, so the source keeps scanning what the link pointed at.
CREATE FUNCTION skill_source_canonical_url(url text) RETURNS text AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(url, '^(https?://[^/]+/[^/]+/[^/]+)/(tree|blob)/.*$', '\1'),
             '^http://', 'https://'),
           '(\.git)?/*$', '');
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
UPDATE "skill_sources"
SET "path" = substring("git_url" from '^https?://[^/]+/[^/]+/[^/]+/tree/[^/]+/(.+)$')
WHERE "path" IS NULL
  AND "git_url" ~ '^https?://[^/]+/[^/]+/[^/]+/tree/[^/]+/.+$';
--> statement-breakpoint
UPDATE "skill_sources"
SET "path" = substring("git_url" from '^https?://[^/]+/[^/]+/[^/]+/blob/[^/]+/(.+)/[^/]+$')
WHERE "path" IS NULL
  AND "git_url" ~ '^https?://[^/]+/[^/]+/[^/]+/blob/[^/]+/.+/[^/]+$';
--> statement-breakpoint
DELETE FROM "skill_sources" s
WHERE EXISTS (
  SELECT 1 FROM "skill_sources" o
  WHERE o."owner" = s."owner"
    AND skill_source_canonical_url(o."git_url") = skill_source_canonical_url(s."git_url")
    AND (o."created_at", o."id") < (s."created_at", s."id")
);
--> statement-breakpoint
UPDATE "skill_sources"
SET "git_url" = skill_source_canonical_url("git_url")
WHERE "git_url" <> skill_source_canonical_url("git_url");
--> statement-breakpoint
DELETE FROM "agent_skills" a
WHERE EXISTS (
  SELECT 1 FROM "agent_skills" o
  WHERE o."agent_id" = a."agent_id"
    AND o."name" = a."name"
    AND skill_source_canonical_url(o."source") = skill_source_canonical_url(a."source")
    AND (o."installed_at", o."source") > (a."installed_at", a."source")
);
--> statement-breakpoint
UPDATE "agent_skills"
SET "source" = skill_source_canonical_url("source")
WHERE "source" <> skill_source_canonical_url("source");
--> statement-breakpoint
UPDATE "agent_skill_publishes"
SET "source_git_url" = skill_source_canonical_url("source_git_url")
WHERE "source_git_url" <> skill_source_canonical_url("source_git_url");
--> statement-breakpoint
UPDATE "skill_sets"
SET "skills" = COALESCE(
  (
    SELECT jsonb_agg(DISTINCT jsonb_set(e, '{source}',
             to_jsonb(skill_source_canonical_url(e->>'source'))))
    FROM jsonb_array_elements("skills") e
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof("skills") = 'array';
--> statement-breakpoint
DROP FUNCTION skill_source_canonical_url(text);
