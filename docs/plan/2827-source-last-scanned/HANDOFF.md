# Handoff — plan #2827, inside epic #3022

**Written:** 2026-08-05. **Author:** session that triaged epic #3022 and reviewed the two in-flight PRs.
**Your job:** run `plan-feature` on **[#2827 — Show when a skill source was last scanned](https://github.com/dam-agents/dam/issues/2827)**. Nothing else.

Owner: Petr (@PetrBulanek). Epic #3022 must close **Monday 2026-08-10**.

> **Read §2 before planning.** Two PRs are open and unmerged on files you will touch. Which branch you base on is a decision, not a default.

---

## 1. Epic state

[#3022 "Close the Skills usability gaps"](https://github.com/dam-agents/dam/issues/3022). Goal: *"what the interface says is true, every visible action does something."* Epic-level out of scope: **new Skills capabilities**.

| Issue | State |
|---|---|
| #2825 delete/download standalone | closed (`b1b64178`) |
| #2828 system vs. user provenance | closed (`a67018d1`) |
| #3019 publish badge | **PR [#3139](https://github.com/dam-agents/dam/pull/3139) open, unreviewed** |
| #2826 preview perf | **PR [#3129](https://github.com/dam-agents/dam/pull/3129) open, unreviewed** |
| **#2827 last-scanned** | **← plan this** |
| #2824 preview for private + standalone | after #3139 merges (got cheaper — see §5) |
| #3023 search / bulk / reuse | needs splitting + design |
| #2654 cache agent-resolved settings | recommend detaching from epic |

Agreed order was #3019 → #2826 → #2827 → #2824 → #3023 → #2654. #2827 is next because it is the only remaining item that is both small and **not** downstream of an unmerged PR's UI rewrite. Do not re-derive the ordering.

---

## 2. The two open PRs — what they mean for you

### PR #3129 (#2826) — 6 files, +79/-78, small and clean

Added `dir` to `skillSchema`, switched the preview to one pinned `raw.githubusercontent.com/.../{dir}/SKILL.md` GET served off the shared scan cache, renamed `readPublicSkill` → `readPublicSkillFile`. **It touches `compose.ts`, `skills-service.ts`, `public-archive-scanner.ts`, `api-server-api/.../schemas.ts` and `docs/architecture/skills.md` — four of the five files you need.**

### PR #3139 (#3019) — 39 files, +6790/-162, two DB migrations

Went with the issue's option B (resolve real PR state) rather than the "say less" option, and added two features beyond the issue. Relevant to you: it rewrote `standalone-skills-group.tsx`, extracted a new `standalone-skill-row.tsx`, and **touches `skill-source-card.tsx` and `use-skills-surface.ts`** — the other two files you need.

### Consequence: base your branch on `main` *after #3129 merges*

The two PRs overlap on 5 files and both sit on `main`, so they conflict with each other. The advised merge order is **#3129 first** (6 files), then rebase #3139 onto it. Ask Petr where things stand before you branch. Three outcomes:

- **#3129 merged** → branch from `main`. Clean. Preferred.
- **#3129 still open** → branch from `perf/2826-skill-preview-pinned-read` and say so in the plan, or wait. Do **not** branch from plain `main` and edit `compose.ts`/`skills-service.ts` in parallel — you will hand Petr a third-way conflict in the same functions.
- **#3139 merged first** → re-read `skill-source-card.tsx` and `use-skills-surface.ts` before planning the UI slice; both changed.

Known CI state, so you don't misread it: #3129's `mise check` is **stuck pending at 0s** (needs a kick, not a fix). #3139's `build-claude-code-vm` **fails**, and it is **not** caused by that change — the failing step is `usermod -d /home/agent root` → `Creating mailbox file: No such file or directory`, exactly what `4b51d4eb` fixed on `main`; the branch's merge-base is `2e55148f`, seven agent/VM commits behind, and the PR touches zero files under `packages/agents/`, `packages/platform-base/` or `.github/`. A rebase clears it.

---

## 3. #2827 — the problem and the shape of the fix

The design for a skill source card shows a **"scanned X ago"** timestamp. Nothing records it. A re-scan shows only a brief spinner, so a user can't tell how fresh a source's skill list is or whether re-scanning is worth it. Deferred from #944 ("needs a last-scanned field on the source").

### Design finding: no migration needed, and no new table

The obvious instinct is a `lastScannedAt` column on `skill_sources`. **Resist it**, for two reasons:

1. **Two of the three source kinds have no row to hang a column on.** Per [`docs/architecture/skills.md`](../../architecture/skills.md) § Skill Source and § Persistence touchpoints: user sources are rows in `skill_sources`, but **system** sources come from the `SKILL_SOURCES_SEED` env and **template** sources are synthesised at request time from `template.spec.skillSources`. Neither persists. A column covers one kind out of three; a persistent design needs a whole new table keyed on `(gitUrl, path)`.
2. **The in-memory cache is already truthful.** `sharedScanCache` lives at module scope in [`compose.ts:31`](../../../packages/api-server/src/modules/skills/compose.ts) as `{ skills, expiresAt }`, keyed `(gitUrl, path)`, 5-minute TTL. On an api-server restart the cache is empty, so the next `list` performs a **real upstream scan** — meaning a `scannedAt` recorded there always denotes an actual read of the source, never a stale claim. Restart shows "scanned just now" because it genuinely just scanned.

So the whole feature is: **add `scannedAt` to the cache entry and carry it to the card.** Confirm this reasoning against the code yourself, then state the conclusion in the plan — it is the single decision that keeps this a one-day change.

### The plumbing path, in order

1. [`compose.ts:20-54`](../../../packages/api-server/src/modules/skills/compose.ts) — `CacheEntry` gains `scannedAt`; `scanWithCache` stamps it on a miss and returns it on a hit. Note `scanWithCache` is also the function `getSkillContent` now calls after #3129, so keep its signature change deliberate.
2. `SkillsServiceDeps.scanSource` + `SkillsService.list` — return shape widens (see the contract decision below).
3. Router `list` procedure — currently `.output(z.array(skillSchema))` in [`packages/api-server-api/src/modules/skills/router.ts`](../../../packages/api-server-api/src/modules/skills/router.ts).
4. [`use-skills-surface.ts`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts) — `loadSkills` stores the timestamp alongside `skillsBySource` (a parallel `scannedAtBySource` record mirrors the existing `loadingBySource` / `errorBySource` idiom).
5. [`skill-source-card.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-source-card.tsx) — render it in the header, near the existing `{enabled} of {list.length} on` at line ~164.

**A property worth calling out in the plan:** `refreshSource` invalidates the cache then calls `loadSkills` again ([`use-skills-surface.ts:376-390`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts)), so if `scannedAt` rides on the `list` response the timestamp refreshes after a re-scan for free — no extra wiring, and the spinner the issue complains about now resolves into something informative.

**Use the existing formatter.** `timeAgo` already exists at [`packages/ui/src/lib/format-time.ts:30`](../../../packages/ui/src/lib/format-time.ts) (alongside `largestUnit`, `timeUntil`, `formatTimestamp`). Do not write a new relative-time helper.

### Contract decision you must make explicitly

`skills.list` returns a bare `Skill[]` today. Two options:

- **Widen to `{ skills, scannedAt }`** — one query, one round trip, timestamp always consistent with the list it describes. Cost: every caller changes.
- **Separate query** — leaves `list` alone, but adds a round trip and lets the two values disagree.

Recommend the first, but you must handle the caller the file list won't show you: **the MCP tool `list_skills_in_source` calls `deps.skills.list(sourceId, agentId)` directly** at [`mcp-endpoint.ts:533`](../../../packages/api-server/src/apps/harness-api-server/mcp-endpoint.ts), and its description promises "each skill's name, description, and the last-touching commit SHA". Widening the service return means updating that tool so agents don't start receiving a wrapper object where they expect an array. Cover it in the plan — an agent-facing regression here is invisible in the UI.

---

## 4. Conventions and verification

- **`mise` is the only task runner.** Never call `pnpm`/`go`/`kubectl`/`helm` directly. `mise run lint:fix` after UI edits.
- **Read [`docs/architecture/skills.md`](../../architecture/skills.md) first** — source of truth, not the code. It documents the scan cache in § api-server skills service and § Listing & scan; both mention the 5-minute TTL, so both likely need a touch, plus the `Last verified:` date. Do not read ADRs.
- **Invoke `react-ui-engineering`** for the UI slice ([`packages/ui/CLAUDE.md`](../../../packages/ui/CLAUDE.md) mandates it). For the api-server slice, `typescript-engineering`.
- **Planning writes only uncommitted markdown** under `docs/plan/2827-source-last-scanned/`. Owner's standing rule: planning sessions never touch tracked files. There is a CI gate — `no docs/plan in merge result` — so plan docs must not reach the merge result.
- **Commits:** Conventional Commits, `git commit -s`, never mention Claude/Anthropic/AI, no Co-Authored-By. **PR title is Conventional Commits too.** Branch `feat/2827-source-last-scanned`.
- **Comments sparingly** — the non-obvious *why* only.
- **Tests: prefer removing over adding.** A cache-entry field plus a rendered timestamp does not obviously earn new tests; `scanWithCache`'s hit/miss/invalidate behavior might. Make a deliberate call and justify it.
- **Never hardcode the brand.**

**Verification** is unit tests plus a manual pass on the local k3s dev cluster (`cluster-ops` skill). Four traps that cost hours if you don't know them:

- The dev app is served over **`http://localhost:4444`** — https 404s at Traefik.
- The UI **service worker serves a stale bundle** after a build; verify the loaded script matches the served one before concluding your change didn't apply.
- If another worktree's vite owns 5173, `ui:run` lands on 5174 and **localhost:5173 serves the other branch**.
- A blank or field-missing sandbox page usually means a **stale api-server** missing a field the UI expects — rebuild with `cluster:build-apiserver` rather than adding UI guards. Relevant here: zod `.output()` **silently strips** contract fields an older api-server doesn't send, so a widened `list` response can look like a UI bug.

---

## 5. Resolve with the owner before finalizing

1. **Where #3129 stands** — merged, or do you stack on its branch? (§2.) This is the first question; it decides your base.
2. **Pull the Figma.** #2827 says the timestamp should appear "as the design intends", and the epic carries `needs design`. The owner's standing instruction is to pull referenced frames before implementing UI — plan prose is a summary, the frame is the source of truth. #2827 links no frame; the related #2124 used `https://www.figma.com/design/zNIYydUKN1QLZDYozpQJpn/DAM-DEV?node-id=964-2261`. Ask for the source-card frame, and settle: exact copy ("scanned 4m ago" vs "Scanned 4 minutes ago"), placement relative to the `N of M on` counter, and whether a never-scanned or errored source shows anything at all.
3. **What an errored source shows.** A scan that failed populates `errorBySource` and no cache entry. Does the card show the last *successful* scan time, nothing, or something else? The issue doesn't say; the honest default is to show nothing rather than a time that predates a failure the user can see.

---

## 6. Not yours to act on

Raised with the owner, still undecided. Mention only if asked.

- **Detach #2654 from the epic** — only item needing a migration of its own, spans agent-runtime + api-server + UI, and its skills half already works ([`skills-service.ts:631`](../../../packages/api-server/src/modules/skills/services/skills-service.ts) returns tracked refs while stopped). Its real subject is the model, a harness-config concern gating nothing else here. Motivated by #2124, which shipped and closed on 2026-07-30 without it.
- **Split #3023** — search is nearly free (every source is already eagerly scanned on mount, [`use-skills-surface.ts:194`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts)); bulk-toggle is medium; "carry a selection to a new sandbox" is not ready (two open questions, and [`wizard-snapshot.ts:30`](../../../packages/ui/src/modules/sandboxes/lib/wizard-snapshot.ts) has no skills field). That third bullet should become its own post-deadline issue.
- **#2824 got cheaper.** #3139 added `readPullRequest` to the agent-runtime skills router plus a `PodPrStateReader` ([`pod-pr-state-reader.ts`](../../../packages/api-server/src/modules/skills/infrastructure/pod-pr-state-reader.ts)) — a working precedent for "api-server asks the pod to read GitHub through the credential-injecting gateway", which is exactly what #2824's private-source preview needs. One design difference to carry forward: #3139 deliberately **never wakes** a hibernated pod for a badge, whereas a preview is user-initiated, so waking may well be right there (`getSkillContent` already receives `agentId`, and sibling read paths use `ensureAgentReachable`, which wakes).

---

## 7. Start here

1. Ask Petr question 1 in §5 — it decides your base branch.
2. Read [`docs/architecture/skills.md`](../../architecture/skills.md) § Skill Source, § api-server skills service, § Listing & scan, § Persistence touchpoints.
3. Read [`compose.ts`](../../../packages/api-server/src/modules/skills/compose.ts) in full (92 lines) — the whole cache lives there.
4. Get the Figma answers, then run `plan-feature` on #2827 and write the plan into this directory. Two slices (api-server contract, then UI) is the honest decomposition; one is defensible. Resist inflating it.
