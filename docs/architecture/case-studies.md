# Case studies

Last verified: 2026-09-04

## Overview

A **Case Study** is a sanitized, plain-English, one-page account an agent writes about itself: the use case it serves, what it delivered, what it cost, and where the platform got in the way. The **agent-case-study skill** produces it from the agent's real history; the platform stores each **Edition** — one per agent per week — where the owner, the platform team, and a future processing system can read it, each through their own gate.

The subsystem is deliberately split across three concerns:

- **The skill** (image-shipped) does the mining, sanitizing, and writing, entirely inside the agent's own pod.
- **The api-server case-studies module** owns edition storage: the submit path, the owner surface, the inspector read surface, and retention.
- **Consent, scheduling, and processing are elsewhere.** Opting an agent in or out, owner review UI, and reading what accumulates are follow-up work; this subsystem only guarantees that a pending edition is invisible until the owner releases it.

## The skill

The skill directory ships in the platform-base image under the staged-skills dir ([skills](skills.md)), so every harness image carries it, and it is consumed in place rather than copied onto any agent's PVC. It is deliberately **off every skill path**: no harness ambient-discovers it, so it costs no context on unrelated turns and can never self-trigger. Invocation is always an explicit reference to that path — the canonical weekly schedule task, which the contract package owns, and the Claude Code `/agent-case-study` command shim both point at it. The schedule task text is frozen into each schedule row at opt-in, so it stays a thin pointer plus a refusal clause; every behavior worth iterating on lives in the image-shipped `SKILL.md`, which is always current in a running pod.

The skill's evidence sources are harness-aware:

- **The platform session index** (`$HOME/.platform/session-metadata.json`, [agent-lifecycle](agent-lifecycle.md)) is the harness-agnostic session inventory — ids, timestamps, and the scheduled / channel-driven / experiment classification that transcript paths cannot provide.
- **A per-harness locator** the skill directory carries probes the filesystem for the harness's own transcript store — claude-code-family JSONL, bob's SQLite, pi's session files and memory dir, codex by runtime probe — and a companion reference alongside it says how to read each. No env var identifies the harness in-pod; probing is the only signal.
- **Cost comes from `get_usage_summary` only** — the agent-facing MCP read over the metrics service ([metrics](metrics.md)), pinned server-side to the calling agent. When the telemetry backend is disabled the tool answers `available: false` and the skill reports cost as not measured; the skill never counts tokens out of transcripts.

## Editions and their states

An Edition's identity is `(agent, week start)` — the Monday (UTC) of the submitting week, taken from the server clock. Keying the week by a real date rather than an ISO `YYYY-Www` stamp keeps the column range-filterable and sortable and removes week-numbering from the code entirely: a week that spans New Year needs no special case, because the Monday it started on already carries the year. Submitting again in the same week **replaces** that week's edition and resets it to `pending` — re-released content the owner has not seen does not exist.

```
pending → released ⇄ hidden → deleted (tombstone) → purged
```

- **pending** — what `submit_case_study` writes. Visible to the owner only; the inspector surfaces never serve it.
- **released** — the owner's explicit consent event, a status flip (`caseStudies.release` over tRPC). The only state the inspector surfaces serve.
- **hidden / deleted** — reserved for the consent surface's opt-out and withdrawal levers; `deleted` is a tombstone (recoverable) until the sweep purges it after a grace window.

The owner's copy in the artifact library is not a second store of record: the edition row is **replaced** by a re-run while the artifact **appends a version** ([artifact-library](artifact-library.md)), so the platform holds only the latest edition while the owner keeps the revision history of their own copy.

That copy is also **the draft the owner edits**. While an edition is pending, the linked artifact is what the owner surface reads and what release publishes, so an edit to it reaches the platform team; the row meanwhile holds only what the agent last submitted, and each response says which of the two it carried and sizes that one. Listing does not resolve — one artifact read per row is the wrong trade for a length — so a pending row reports the submitted text and says so, and a reader that needs the draft fetches the edition. Releasing **freezes** the resolved text into the row and stops consulting the artifact ever after — consent attaches to specific words, so an edit made after release must not rewrite what an inspector already read, just as an edit made before it must not be ignored. An artifact that cannot stand in for the draft (deleted, another owner's, binary, oversized, or outside the content bounds) falls back to the submitted text rather than failing the owner's read: a missing artifact is not a reason to refuse someone their own consent. The skill scopes its lookup of that copy to the artifacts it published itself — every agent an owner runs titles its weekly copy the same way, and an update is owner-scoped rather than agent-scoped, so an unscoped title match would let one agent publish over another's.

Attribution is server-stamped and unforgeable: the agent id comes from the mesh-bound MCP session, never tool input; the harness image is read from the Agent CR at submit time so it survives agent deletion. Owner resolution rides the `agents` mirror ([usage-tracking](usage-tracking.md)) — editions carry no owner column. Content is the sanitized markdown itself, size-capped, in a Postgres text column: small, bounded, queryable, and retention or withdrawal is a row delete with no blob side to orphan.

## Read paths

- **Owner** — owner-scoped tRPC (`caseStudies.list` / `get` / `release`), scoped by the same live-plus-registry owned-agent union the metrics reads use, so a deleted agent's editions stay visible to the owner who collected them.
- **Platform team** — `GET /api/case-studies` (metadata, filterable by update time, week, and agent — the week filter takes any real calendar date and matches the week containing it; both read surfaces parse the filter through one schema in the contract package, so neither can accept what the other rejects) and `GET /api/case-studies/:id` (content), gated by the `platform-inspector` realm role exactly like `/api/usage`, mounted as a no-op router when the role is unconfigured.
- **Agents whose owner is an inspector** — `list_case_studies` / `get_case_study` MCP tools, registered at MCP session creation only when the agent's owner carries the inspector role. The check reads the recorded inspector-role flag on the actor-roles projection ([usage-tracking](usage-tracking.md)), which records inspector-role carriage at auth time; that saga runs unconditionally (independent of the activity-tracking toggle) precisely so this gate works on installs that disabled activity writes. A grant or revocation lands on the owner's next authenticated request, and tool registration follows at the next MCP session — so a revoked inspector keeps a live session's tools until it ends. This is the intended read path for the future processing system — an agent cannot reach Postgres and holds no bearer tokens, so cross-owner reads ride mesh identity plus the recorded role.

Every submit, release, and inspector read is security-logged (`case_study.submitted` / `case_study.released` / `case_study.inspect`).

## Retention

A daily platform periodic job purges editions older than the configured retention window (`apiServer.caseStudies.retentionDays`, default 365), and withdrawn (tombstoned) editions past their own shorter grace window (`apiServer.caseStudies.tombstoneGraceDays`, default 30). Both windows are knobs because the legal review of data-collection streams has not settled; the single-table shape keeps stricter and looser outcomes alike one-line changes. The sweep is an interval, not a wall-clock schedule: a purge lags its window by up to a day, and an install that stays down past a slot re-aligns to the next one rather than catching up at boot.

## Persistence touchpoints

One Postgres table, `agent_case_studies` ([`packages/db/src/schema.ts`](../../packages/db/src/schema.ts)): unique on `(agent_id, edition_week_start)`, status as text, partial index on tombstones for the sweep. Rows survive agent deletion deliberately — attribution metadata stays valid, and withdrawal is an explicit owner action, not a side effect.

## Where the code lives

- Skill: [`packages/platform-base/dam-skills/agent-case-study/`](../../packages/platform-base/dam-skills/agent-case-study/)
- Contract (types, schemas, router, canonical schedule task): [`packages/api-server-api/src/modules/case-studies/`](../../packages/api-server-api/src/modules/case-studies/)
- Implementation (repository, services, routes, MCP tools, sweeper): [`packages/api-server/src/modules/case-studies/`](../../packages/api-server/src/modules/case-studies/)
- Agent-facing usage read: [`packages/api-server/src/modules/metrics/services/agent-usage-summary.ts`](../../packages/api-server/src/modules/metrics/services/agent-usage-summary.ts)

## Invariants

- **A pending edition never leaves the owner's boundary.** Inspector routes, inspector MCP tools, and the future processing path all read through one service whose filter is `released` — there is no second query path to widen.
- **Submission identity is server-stamped.** Agent id from the mesh-verified MCP session, week start from the server clock, harness image from the Agent CR; the agent declares only content, window, and its own artifact reference.
- **Release is the consent event.** Content changes (resubmission) always fall back to `pending`; nothing an agent does can make content externally visible.
- **The skill is invoked, never discovered.** Staying off the skill paths is what makes "the skill cannot self-trigger" a filesystem property rather than a prompting hope.
