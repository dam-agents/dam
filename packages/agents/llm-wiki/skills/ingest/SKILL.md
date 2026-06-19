---
name: ingest
description: Turn source-repo code & docs into maintained wiki pages. Runs over every source in wiki.config.json (or one named source). The first pass per source is tiered eager (map the repo, summarise top-down, drill on demand); every later pass is delta (re-ingest only files changed since that source's watermark). Runs on the maintenance schedule. Use when adding a source or refreshing the wiki from new commits.
---

# ingest

Maintenance runs over every entry in `wiki.config.json` `sources[]`; onboarding's
first pass may target a single source. Each entry has a `repo` (`org/repo`), an
optional `ref`, and a `watermark_sha`. Process one source at a time.

## Per source

1. **Fetch.** `scripts/fetch-source.sh <repo> [ref]` shallow-clones into
   `sources/<name>` (`<name>` = the `repo` basename) and prints the resolved HEAD
   SHA on stdout. Capture it as `$sha`: it is the page `commit:`, the `@sha` in
   every citation, and the value you bump the watermark to. Pin to this `$sha`
   throughout — never to a HEAD you read later.
2. **First or delta?** `scripts/watermark.mjs read <repo>` → empty means this
   source was never ingested (tiered eager). A non-empty `$wm` means delta from
   `$wm`. If `$wm` already equals `$sha`, HEAD has not moved — skip this source.

## Tiered eager (first ingest)

1. **Map** — build a cheap structural overview (dir tree, languages, entry
   points, top-level modules, docs index) without reading every file. Write one
   source overview page at `wiki/pages/sources/<name>.md`.
2. **Summarise top-down** — one page per module/dir: purpose, key files, public
   surface, and cross-links to the entities and concepts it touches.
3. **Drill on demand** — full per-file detail only where it carries weight (entry
   points, core abstractions). Leave the long tail for when a query makes it hot.

## Delta (subsequent ingests)

1. `scripts/changed-files.sh <name> <$wm>` lists what moved since the watermark,
   one tab-separated `git diff --name-status` line per file: `M<tab>path`,
   `A<tab>path`, `D<tab>path`, `R<score><tab>old<tab>new`. (A bare `FULL` means no
   watermark — fall back to tiered eager.)
2. Re-ingest only the touched modules/files:
   - **A / M** — refresh every page whose `files:` covers them; add pages for
     genuinely new modules.
   - **D** — drop the deleted path from affected pages' `files:`; retire a page
     that loses its whole subject and note it for `lint`.
   - **R** — update the path in `files:` and in citations.
3. Update the entities and concepts the change touches, plus their cross-links.

## Every page

Provenance frontmatter and inline `file:line @sha` citations per `CLAUDE.md`,
with `commit: $sha`. Add or update the page's line in `wiki/index.md`. Where
sources disagree, flag it for `lint` — do not silently reconcile.

## Finish (per source)

Once the source's pages are written, bump its watermark to the SHA you fetched:
`scripts/watermark.mjs bump <repo> <$sha>`. Append one `wiki/log.md` entry:
`## [date] ingest | <repo> @<sha>`.

After all sources are done, commit and push the `wiki/` repo
(`ingest: <source> @<sha>`) — per `CLAUDE.md`. A run where no source's HEAD
advanced is a no-op.
