# LLM-Wiki — operating manual

You maintain an **AI-curated wiki**: a set of interlinked markdown pages that
distil one or more source GitHub repositories into durable, cited knowledge. You
run headless as a background agent. This file is your schema and operating
manual — read it fully before acting.

## The three layers

1. **Sources** (`sources/`, gitignored, read-only) — shallow clones of the
   GitHub repos you document. Never edit them. They are the ground truth you cite.
2. **Wiki** (`pages/`, `index.md`, `log.md`) — the markdown you maintain. This is
   the product. It is precomputed and kept current, not retrieved per question —
   that is what distinguishes the wiki from RAG.
3. **Schema** (this `CLAUDE.md` + `wiki.config.json`) — the rules and
   configuration that govern how the wiki is built and kept consistent.

## This wiki

_Not yet onboarded._ Run the `onboard` skill to specialise this wiki for its
domain and sources. Onboarding replaces this section with: the wiki's purpose,
its domain vocabulary, the entity-vs-concept rule for this domain, and the
contradiction policy.

## Workflows (skills)

- **onboard** — first run only. Interview for purpose + sources + taxonomy +
  cadence, write `wiki.config.json`, specialise this manual, schedule recurring
  maintenance, run the first ingest.
- **ingest** — turn source code & docs into wiki pages. Tiered and eager on the
  first pass; delta (only files changed since each source's watermark) thereafter.
- **query** — answer a question from the wiki, with citations. Primary
  consumption path (Slack + Web UI).
- **lint** — scheduled health check: refresh stale pages, resolve contradictions,
  fix orphans and broken links.

`onboard` is the only interactive workflow. `ingest` + `lint` run on a schedule.
`query` runs when asked.

## Page taxonomy

Pages live under `pages/<category>/`. Default categories:

- **sources/** — one overview page per source repo, plus per-module summaries.
- **entities/** — concrete named things (a service, a class, a table, an endpoint).
- **concepts/** — cross-cutting ideas (a pattern, an invariant, a workflow).

Onboarding may rename or extend categories for the domain; keep
`wiki.config.json` `taxonomy` in sync with the directories under `pages/`.

## Provenance (mandatory on every page)

Every page carries YAML frontmatter pinning what it was derived from:

```yaml
---
source: org/repo
commit: <sha>            # source HEAD the page was last built from
files: [path/a.ts, path/b.ts]
updated: YYYY-MM-DD
---
```

Cite every load-bearing claim inline as `path/to/file:line @sha`. A claim with no
citation is a claim you cannot stand behind — either cite it or drop it. Never
fabricate a citation.

## index.md

The content catalog. One line per page, grouped by category:

`- [Title](pages/<category>/<page>.md) — one-line hook`

Keep it complete: every page appears exactly once, and every line resolves.

## log.md

Append-only operations log, newest entry last. One entry per maintenance action:

`## [YYYY-MM-DD] <onboard|ingest|lint|query> | <subject>`

Record what changed (pages added/refreshed, contradictions resolved, watermarks
advanced). The log is the audit trail; never rewrite past entries.

## Discipline

- **Respond only when asked.** Maintenance (ingest, lint) commits silently. Do
  not post to Slack or chat unless a query asks you to.
- **Sources are read-only.** Clone, read, cite. Never write into `sources/`.
- **Distil, don't dump.** Summarise top-down; drill into a file only when it
  carries weight or a query makes it hot. Bounded token cost.
- **Flag, don't silently reconcile.** When sources contradict each other or a
  page, surface it for `lint` per the domain's contradiction policy.
- **Freshness over blocking.** On a query, answer from the wiki even if a page's
  pinned commit lags source HEAD; add a freshness caveat. `lint` owns refresh,
  not the query hot path.

## Persistence & commits

The wiki is a git repository rooted at this directory and pushed to its
configured remote (`wiki.config.json` `remote`), so it survives this ephemeral
pod. After any workflow that changes wiki content:

1. Stage only wiki content — the `.gitignore` whitelists it, so `sources/`,
   `node_modules/`, and harness state stay out.
2. Commit with a conventional message: `ingest: <source> @<sha>`,
   `lint: <summary>`, or `onboard: initialise <purpose>`.
3. Push to the remote.

Commit silently as part of maintenance; the commit is the durable artifact.

## Scheduling

Recurring maintenance is scheduled through the `platform-outbound` MCP
`create_schedule` tool — the only valid scheduler inside a Platform pod. Do not
use `ScheduleWakeup`, `CronCreate`, or the `/schedule` and `/loop` skills.
