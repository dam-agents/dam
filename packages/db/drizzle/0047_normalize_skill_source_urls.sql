-- #3539: A repository has one identity but many written forms. Until now every
-- form was stored verbatim, so `http://`, a trailing slash, a `.git` suffix and
-- a pasted `/tree/<branch>/<dir>` URL each registered as a separate source and
-- only one of them scanned. New rows are normalized by
-- `normalizeGitUrl` (packages/agent-runtime-api) before they reach Postgres;
-- this migration rewrites the rows that were stored before that, by the same
-- rules. Sources that collapse onto one canonical URL are merged into the
-- oldest row, and installed refs follow them. The directory of a pasted
-- `/tree/` URL becomes the source's path when it has none, so the source keeps
-- scanning what the link pointed at.
CREATE FUNCTION skill_source_url_decode(input text) RETURNS text AS $$
  SELECT convert_from(
    (
      SELECT string_agg(
        CASE WHEN m[1] ~ '^%[0-9a-fA-F]{2}$'
             THEN decode(substring(m[1] from 2), 'hex')
             ELSE convert_to(m[1], 'UTF8') END,
        ''::bytea ORDER BY i)
      FROM regexp_matches(input, '%[0-9a-fA-F]{2}|.', 'g') WITH ORDINALITY AS t(m, i)
    ),
    'UTF8');
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
CREATE FUNCTION skill_source_decode_path(p text) RETURNS text AS $$
DECLARE
  seg text;
  out text := '';
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  FOREACH seg IN ARRAY string_to_array(p, '/') LOOP
    seg := skill_source_url_decode(seg);
    IF seg IS NULL OR seg = '' OR seg = '.' OR seg = '..'
       OR strpos(seg, '/') > 0 OR strpos(seg, chr(92)) > 0 THEN
      RETURN NULL;
    END IF;
    out := CASE WHEN out = '' THEN seg ELSE out || '/' || seg END;
  END LOOP;
  RETURN out;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint
CREATE FUNCTION skill_source_canonical_url(url text) RETURNS text AS $$
DECLARE
  out text := url;
  origin text;
BEGIN
  out := regexp_replace(out, '[?#].*$', '');
  IF out !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://' THEN
    out := 'https://' || out;
  END IF;
  out := regexp_replace(out, '^(https?://)[^/@]*@', '\1');
  origin := substring(out from '^[^:]+://[^/]*');
  IF origin IS NOT NULL THEN
    out := lower(origin) || substr(out, length(origin) + 1);
  END IF;
  out := regexp_replace(out, '^http://', 'https://');
  out := regexp_replace(out, '^(https://[^/:]+):(80|443)(/|$)', '\1\3');
  out := regexp_replace(out, '^https://www\.github\.com(/|$)', 'https://github.com\1');
  out := regexp_replace(out, '/-/(tree|blob)/', '/\1/');
  out := regexp_replace(out, '^(https://[^/]+/[^/]+/[^/]+(?:/[^/]+)*?)/(tree|blob)/.*$', '\1');
  IF out ~ '^https://github\.com/' THEN
    out := lower(regexp_replace(out, '^(https://github\.com/[^/]+/[^/]+).*$', '\1'));
  END IF;
  RETURN regexp_replace(out, '(\.git)?/*$', '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint
UPDATE "skill_sources"
SET "path" = skill_source_decode_path(substring(regexp_replace("git_url", '/-/tree/', '/tree/') from '^https?://(?:[^/@]*@)?[^/]+/[^/]+/[^/]+(?:/[^/]+)*?/tree/[^/]+/(.+)$'))
WHERE "path" IS NULL
  AND regexp_replace("git_url", '/-/tree/', '/tree/') ~ '^https?://(?:[^/@]*@)?[^/]+/[^/]+/[^/]+(?:/[^/]+)*?/tree/[^/]+/.+$';
--> statement-breakpoint
UPDATE "skill_sources"
SET "path" = skill_source_decode_path(substring(regexp_replace("git_url", '/-/blob/', '/blob/') from '^https?://(?:[^/@]*@)?[^/]+/[^/]+/[^/]+(?:/[^/]+)*?/blob/[^/]+/(.+)/[^/]+$'))
WHERE "path" IS NULL
  AND regexp_replace("git_url", '/-/blob/', '/blob/') ~ '^https?://(?:[^/@]*@)?[^/]+/[^/]+/[^/]+(?:/[^/]+)*?/blob/[^/]+/.+/[^/]+$';
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
--> statement-breakpoint
DROP FUNCTION skill_source_decode_path(text);
--> statement-breakpoint
DROP FUNCTION skill_source_url_decode(text);
