---
name: lint
description: Scheduled health check that keeps the wiki trustworthy — the maintenance that justifies the pattern over plain RAG. Refreshes stale pages, resolves contradictions, fixes orphans and broken wikilinks, and notes coverage gaps. Runs on the maintenance schedule after ingest.
---

# lint

- **Staleness (pin + fix):** for each page, diff its pinned commit + files against
  source HEAD (`scripts/changed-files.sh`). Refresh drifted pages and re-pin.
- **Contradictions:** surface conflicting claims across pages; reconcile factual
  ones, preserve genuine tensions per the domain's contradiction policy.
- **Orphans & broken links:** run `scripts/check-links.mjs`; fix dangling
  wikilinks, link or retire orphans.
- **Coverage gaps:** note ingested-but-undocumented areas worth a future pass.

Finish: apply fixes, append `log.md` (`## [date] lint | <summary>`), commit +
push silently. Respond only when asked.
