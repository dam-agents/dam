---
name: ingest
description: Turn source-repo code & docs into maintained wiki pages. Eager and tiered on the first pass (map the repo, summarise top-down, drill on demand); delta thereafter (re-ingest only files changed since each source's watermark). Runs on the maintenance schedule. Use when adding a source or refreshing the wiki from new commits.
---

# ingest

## First ingest (tiered eager)

1. Clone via `scripts/fetch-source.sh <repo> [ref]`.
2. Map: build a cheap structural overview (tree, languages, entry points,
   modules, docs index). Write a source overview page.
3. Summarise top-down: one page per module/dir — purpose, key files, public
   surface, cross-links to related entities/concepts.
4. Drill on demand: per-file detail only where it carries weight (entry points,
   core abstractions) or when a query is hot. Do not read every file.

## Delta ingest (subsequent runs)

1. `scripts/changed-files.sh <name> <watermark>` → re-ingest only touched
   modules/files.
2. Update affected pages, entities, concepts, and cross-links.

## Every page

Frontmatter (source/commit/files/updated) + inline `file:line @sha` citations.
Update `index.md`. Append `log.md`. Flag contradictions for `lint`; do not
silently reconcile.

## Finish

Bump the source watermark (`scripts/watermark.mjs bump <name> <sha>`), then
commit + push. Re-running with no new commits is a no-op.
