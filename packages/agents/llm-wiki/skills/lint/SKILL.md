---
name: lint
description: Scheduled health check that keeps the wiki trustworthy — the maintenance that justifies the pattern over plain RAG. Refreshes stale pages, resolves contradictions, fixes orphans and broken wikilinks, and notes coverage gaps. Runs on the maintenance schedule after ingest. A clean wiki is a no-op.
---

# lint

Independent per-page verification against the live sources — the safety net for
what `ingest`'s delta missed. Run the checks below, then commit only if something
changed.

## Staleness (pin + fix)

The pod is ephemeral, so `sources/` is usually empty. For each source in
`wiki.config.json`, fetch it first: `scripts/fetch-source.sh <repo> [ref]` clones
it and prints the current HEAD `$sha`. Then, for each page built from that source:

1. `scripts/changed-files.sh <name> <page-commit>` lists what moved since the
   page's pinned `commit:`. Intersect those paths with the page's `files:`.
2. If any of the page's files appear (M / D / R), the page drifted. Refresh it
   against `$sha` following the `ingest` discipline (handle D / R the same way),
   then re-pin `commit: $sha` and `updated:`. A page whose files did not move is
   left untouched — do not re-pin it.

Leave the source watermark alone; it is `ingest`'s cursor, not lint's.

## Contradictions

Surface conflicting claims across pages. Reconcile factual ones; preserve genuine
tensions per the domain's contradiction policy in `CLAUDE.md` `## This wiki`.

## Orphans & broken links

`scripts/check-links.mjs` (no args, from the wiki root) emits
`{ orphans, brokenLinks }`. Repoint or remove each `brokenLinks` target; for each
orphan, add the missing `index.md` line or cross-link, or retire the page.

## Coverage gaps

Note ingested-but-undocumented areas worth a future pass — record them in the log,
don't necessarily fill them now.

## Finish

If nothing changed, stop — a clean wiki is a no-op, no commit. Otherwise append
one `log.md` entry (`## [date] lint | <summary of refreshed / fixed / flagged>`),
then commit + push silently per `CLAUDE.md`. Respond only when asked.
