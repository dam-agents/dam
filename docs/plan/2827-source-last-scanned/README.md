# Show when a skill source was last scanned

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** [#2827 — Show when a skill source was last scanned](https://github.com/dam-agents/dam/issues/2827) (epic [#3022](https://github.com/dam-agents/dam/issues/3022))

## Goal

A skill source card is designed to show a **"scanned X ago"** timestamp so a user can judge how
fresh a source's skill list is and decide whether a re-scan is worth running. Nothing records
that today — a re-scan just flashes a spinner and resolves into no new information. Record when
each source was last scanned and render it on the card, exactly as the design shows: right-aligned
in the card header, immediately left of the kebab, reading `scanned 2h ago`.

## Approach

The whole feature is **one idea: stamp the existing scan-cache entry with a `scannedAt` and carry
that value to the card.** No DB migration, no new column, no new table.

**Why the cache, not a `lastScannedAt` column** (confirmed against
[`docs/architecture/skills.md`](../../architecture/skills.md) § api-server skills service,
§ Listing & scan, § Persistence touchpoints, and the code):

1. **Two of the three source kinds have no row to hang a column on.** User sources are rows in
   `skill_sources`; **system** sources come from the `SKILL_SOURCES_SEED` env and **template**
   sources are synthesised per-request from `template.spec.skillSources`. Neither persists. A
   column would cover one kind of three; a persistent design would need a whole new table keyed
   on `(gitUrl, path)` — far more than this feature warrants.
2. **The in-memory cache is already truthful.** `sharedScanCache` lives at module scope in
   [`compose.ts`](../../../packages/api-server/src/modules/skills/compose.ts) as
   `{ skills, expiresAt }`, keyed `(gitUrl, path)`, 5-minute TTL. On an api-server restart the
   cache is empty, so the next `list` performs a **real upstream scan** — a `scannedAt` recorded
   there always denotes an actual read of the source, never a stale claim. "scanned just now"
   after a restart is honest: it genuinely just scanned.

**Data path** (cache → contract → card):

```
CacheEntry.scannedAt (epoch ms)          compose.ts
  → scanSource dep returns { skills, scannedAt }   skills-service deps
    → SkillsService.list returns { skills, scannedAt: ISO }   skills-service + router
      → skills.list.query() → scannedAtBySource   use-skills-surface.ts
        → SkillSourceCard scannedAt prop → `scanned {timeAgo}`   skill-source-card.tsx
```

**A property worth relying on:** `refreshSource` invalidates the cache then re-calls `loadSkills`
([`use-skills-surface.ts:376`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts)),
so because `scannedAt` rides on the `list` response the timestamp refreshes after a re-scan for
free — no extra wiring, and the spinner the issue complains about now resolves into something
informative ("scanned just now").

## Base branch — plain `main` (both prerequisites merged)

This branch is based on **`main`**. It was originally planned as a stack on
[#3129](https://github.com/dam-agents/dam/pull/3129), but #3129 (`f2d028ce`) and
[#3139](https://github.com/dam-agents/dam/pull/3139) (`5ea02ef1`) both squash-merged on
2026-08-05, and the branch was rebased onto `main` — it now carries only the plan commit.

Both merges are already reflected in the slice files. What they mean for the work, verified
against `main`:

- **From #3129** — `readPublicSkill` is now **`readPublicSkillFile`** (slice 01 doesn't touch it,
  but don't "fix" it back). `skillSchema` already carries a **`dir`** field; `scannedAt` is a
  *list-response* field, **not** a per-skill field, so it does not go on `skillSchema`. Most
  importantly, **`getSkillContent` now calls `deps.scanSource(...)`** — widening that dep's return
  changes **three** call sites on `main` (`list`'s two paths at ~357 and ~380, plus
  `getSkillContent` at ~411), not one.
- **From #3139** — it touched every file this plan references, but **not** the parts slice 01 and
  02 edit. The scan cache in `compose.ts` (`CacheEntry`, `scanWithCache`, `invalidateScanCache`) is
  byte-identical to what slice 01 describes; #3139 only added a PR-state reader/resolver elsewhere
  in that file. On the UI side it added a `suppressedNames` prop to `SkillSourceCard` (which
  filters `list` before the count derives) and `prState` fields to an optimistic publish record in
  `use-skills-surface.ts` — both orthogonal to the timestamp. **Line numbers in the slice files
  drift by a few lines; the anchors themselves all still exist.**

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | api-server: carry `scannedAt` through the scan cache and the `skills.list` contract | Stamp `scannedAt` on `CacheEntry`; widen `scanSource` / `SkillsService.list` / router output to `{ skills, scannedAt }`; unwrap in the MCP `list_skills_in_source` tool; touch the two skills.md scan-cache mentions | — |
| 02 | UI: render "scanned X ago" on the source card | Store `scannedAtBySource` in `use-skills-surface`, thread through `skills-surface` → `SkillSourceCard`, render via `timeAgo` in the header before the kebab | 01 |

Order is linear: the UI can't render a field the contract doesn't yet carry, and a widened `list`
response is what slice 02 consumes.

## Conventions & glossary

- **`scannedAt`** — the wall-clock time a source's skill list was last read from upstream. Held as
  **epoch milliseconds** inside `CacheEntry` (uniform with the existing `expiresAt`); serialized as
  an **ISO-8601 string** on the tRPC wire (matching `skillPublishRecordSchema.publishedAt`, the
  codebase's timestamp convention). The service converts ms → ISO at the contract boundary.
- **`timeAgo`** — the existing past-relative formatter at
  [`packages/ui/src/lib/format-time.ts:30`](../../../packages/ui/src/lib/format-time.ts):
  "just now", "5m ago", "2h ago", "3d ago", "—" for an unparseable value. **Do not write a new
  relative-time helper.** Absolute time on hover uses `formatTimestamp` from the same module.
- **"Show nothing" for a never-scanned or errored source** — a source with no successful scan (no
  cache entry) or whose latest scan errored shows **no** timestamp. Never display a time that
  predates a failure the user can already see on the card. The card guard is `!error && scannedAt`.
- **Engineering skills** — apply [`/typescript-engineering`](../../../.claude/skills) to slice 01
  (server-side TS: tRPC contract, service layer) and [`/react-ui-engineering`](../../../packages/ui/CLAUDE.md)
  to slice 02 (`packages/ui`). Run `mise run lint:fix` after UI edits.
- **`mise` is the only task runner** — never call `pnpm`/`go`/`kubectl`/`helm` directly.
- **Commits** — Conventional Commits, `git commit -s`, never mention Claude/Anthropic/AI, no
  Co-Authored-By. PR title is Conventional Commits too. Comments sparingly — the non-obvious *why*
  only. Never hardcode the brand.

## Whole-feature smoke test

On the local k3s dev cluster (`cluster-ops` skill), served over **`http://localhost:4444`** (https
404s at Traefik):

1. Open a sandbox → **Skills** tab. Each card under **SOURCED FROM GITHUB** shows a muted
   `scanned <time> ago` right-aligned, immediately left of the `⋯` kebab (the `N of M on` counter
   stays by the source name). Hovering it shows the absolute timestamp.
2. Open the kebab → **Re-scan**. A header spinner appears; when it resolves the timestamp updates
   to **`scanned just now`**.
3. A source whose scan errors (e.g. a private/unreachable repo with no agent) shows the error
   banner and **no** timestamp.
4. The **CREATED IN THIS SANDBOX** standalone group is unchanged (`created … · only in this
   sandbox`).

If a card renders blank or drops the new field, suspect a **stale api-server** (zod `.output()`
silently strips a field an older api-server doesn't send) — rebuild with `cluster:build-apiserver`
rather than adding UI guards. Watch for the **service-worker stale bundle** and cross-worktree
**vite port collision** (localhost:5173 may serve another branch) before concluding a change didn't
apply.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
[#2827](https://github.com/dam-agents/dam/issues/2827) —
[PR #3178](https://github.com/dam-agents/dam/pull/3178), based on `main`. The plan folder is
deleted in a final commit before the PR is marked ready — the `Plan check` CI gate keeps the PR
unmergeable until `docs/plan/` is gone.
