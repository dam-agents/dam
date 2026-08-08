# Handoff — plan #3236, inside epic #3022

**Written:** 2026-08-08 (Sat). **Author:** session tracking epic #3022 since triage.
**Your job:** run `plan-feature` on **[#3236 — Skill source scan shows a raw JSON parse error instead of naming the missing connection](https://github.com/dam-agents/dam/issues/3236)**. Nothing else.

Owner: Petr (@PetrBulanek). Epic target was **Monday 2026-08-10**; see §6 — that date no longer holds, and the reason is not this issue.

---

## 1. Epic state — 5 of 10 closed, and the denominator grew

| Issue | State |
|---|---|
| #2825 delete/download standalone | closed |
| #2828 system vs. user provenance | closed |
| #2826 preview perf | closed (PR #3129) |
| #3019 publish badge | closed (PR #3139 + follow-up #3182) |
| #2827 last-scanned | closed (PR #3178, `be56d34a`) |
| #2824 preview private + standalone | **implemented — PR [#3203](https://github.com/dam-agents/dam/pull/3203) open, `REVIEW_REQUIRED`** |
| **#3236 scan error names the cause** | **← plan this** (filed 2026-08-07) |
| #3023 search / bulk / reuse | open — replan against the #3208 prototype (§6) |
| #3208 Rebuild the Skills surface on the new design | open — **new**, gated by its own scope statement (§6) |
| #2654 cache agent-resolved settings | open — recommend detaching (§6) |

**Base your branch on `main` after #3203 merges.** That PR changes four of the files you are most likely to touch: [`agent-runtime-client.ts`](../../../packages/api-server/src/modules/skills/infrastructure/agent-runtime-client.ts), the api-server [`skills-service.ts`](../../../packages/api-server/src/modules/skills/services/skills-service.ts), and agent-runtime's `github-rest-client.ts` and `scan.ts`. Do not start in parallel.

PR #3203's one red check (`merge multi-arch platform-base manifest`, failed at 9s) is **not** its change — the PR touches nothing under `packages/platform-base/`, `packages/agents/` or `.github/`. A re-run should clear it; if it doesn't, it is an infrastructure problem, not a code one.

---

## 2. The bug

A sandbox with **no connections added** has two GitHub skill sources. Both fail to scan, and each source card renders:

```
Unexpected token '<', "<html><bod"... is not valid JSON
```

next to a "Manage connections" link. The user is shown a parser's complaint. Nothing on screen says they have no GitHub connection, or that the repo is private. They cannot tell whether the URL is wrong, the repo is private, the connection is missing, or the product is broken.

This is the most flagrant remaining violation of the epic's goal — *"what the interface says is true"* — because the surface isn't merely vague, it is showing internal transport text.

**Expected:** the card states the cause in plain language and names the fix, keeps the "Manage connections" affordance, and never shows parser or transport text.

---

## 3. Why the existing mapping doesn't catch it — the mechanism

#2836 already fixed the *clear-message* case: a private-source scan failure yields `SCAN_ACCESS_MESSAGE` ("Can't access this repository. If it's private, grant your GitHub connection access to it…"). That message never appears here, so a second failure path reaches the card unfiltered. Here is why.

**The classifier has an escape hatch.** [`runWithUpstreamMapping`](../../../packages/api-server/src/modules/skills/infrastructure/agent-runtime-client.ts) recognizes exactly four shapes — a `TRPCClientError` with no `data` (→ `AgentRuntimeUnreachableError`), `code: "CONFLICT"`, the `PASSTHROUGH_CODES` set, and a `data.upstream` envelope (→ `AgentRuntimeUpstreamError`). **Everything else falls through to a bare `throw new Error(...)`** — including a non-`TRPCClientError` entirely, on the final line.

**The consumer then rethrows it raw.** `skills-service.list` does `throw privateScanErrorToTrpc(err) ?? err`, and [`privateScanErrorToTrpc`](../../../packages/api-server/src/modules/skills/infrastructure/upstream-to-trpc.ts) handles only `AgentRuntimeUpstreamError` and `AgentRuntimeUnreachableError`, returning `null` for anything else — deliberately, so genuine bugs stay visible. A plain `Error` carrying a `SyntaxError`'s text therefore travels intact to the card.

**What produces the parse failure** is what you must confirm by reproducing — do not guess. Two candidate sites, both plausible for a credential-less sandbox where GitHub (or the gateway) answers with an HTML page rather than JSON:

1. **The api-server → pod hop.** The tRPC client parses the HTTP body as JSON; an HTML error page from the mesh or a restarting pod raises `SyntaxError`, which is not a `TRPCClientError` and so hits the final fallback line.
2. **Inside the pod.** `github-rest-client` calls `.json()` on a response that is an HTML page — with no GitHub connection there is no Secret for Envoy to inject, so the request can come back as an HTML error rather than a JSON API error.

The two need different fixes (classify at the hop vs. guard the REST client), so pin it before planning. The reproduce steps in the issue are exact.

**Where the fix belongs, once located:** the principle is that *no* error should reach the card without passing through a classifier that either names a cause or says something honestly generic. A parse failure means "the response wasn't the API talking" — which for this surface is the same user-facing situation as 401/`upstream_unreachable`, already in the `SCAN_ACCESS_MESSAGE` family. Consider whether the right change is one more branch in that family or a final catch-all that replaces any unclassified message with a neutral one. Prefer the latter as a backstop *plus* the former as the named case — an unclassified error should never again be able to reach a user verbatim.

The UI end already works and likely needs no change: [`SourceError`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-source-card.tsx) renders the message, splits out a `platform-cta:<url>` suffix, and falls back to a client-built "Manage connections" button. It renders faithfully whatever the server sends — the defect is upstream of it.

---

## 4. The two open questions in the issue

Both are the owner's to answer; get them before finalizing.

1. **Should a source needing credentials be blocked at add time**, with the connection prompt shown then, instead of failing later on the card? This is a materially larger change (it moves validation into `sources.create`) and arguably its own issue. Recommend keeping #3236 to the error-message fix and filing the add-time gate separately if he wants it — say so explicitly rather than silently narrowing.
2. **Is any non-actionable error text acceptable here**, or must every failure map to a named cause? This decides whether you ship a catch-all backstop or enumerate causes exhaustively. The backstop is the safer answer for a deadline week.

Worth raising unprompted: the screenshot shows the error where a **public** source would have scanned fine from the api-server without any pod. Confirm with him whether these two sources are private, or whether a *public* source is also failing — the latter would be a different and more serious bug than the one filed.

---

## 5. Conventions and verification

- **`mise` is the only task runner.** Never call `pnpm`/`go`/`kubectl`/`helm` directly. `mise run lint:fix` after UI edits.
- **Read [`docs/architecture/skills.md`](../../architecture/skills.md) first** — source of truth, not the code. § api-server skills service and § Listing & scan cover this path. Update `Last verified:` if you change documented behavior. Do not read ADRs.
- **Skills:** `typescript-engineering` for the api-server/agent-runtime work; `react-ui-engineering` if you end up touching the card.
- **Planning writes only uncommitted markdown** under `docs/plan/3236-scan-error-names-the-cause/`; planning sessions never touch tracked files. CI gate `no docs/plan in merge result` — follow the `chore(plan): drop …` pattern used by #2827 and #2824 before merge.
- **Commits:** Conventional Commits, `git commit -s`, no mention of Claude/Anthropic/AI, no Co-Authored-By. PR title is Conventional Commits too. Branch `fix/3236-scan-error-names-the-cause`.
- **Check `git branch --show-current` immediately before committing** — concurrent sessions share this checkout and move HEAD. It is currently sitting on `feat/2824-preview-private-and-standalone`.
- **Comments sparingly**; **prefer removing tests over adding**. An error-classification branch is one of the cases that genuinely earns a unit test — the whole point is that an unclassified shape must not escape. Justify what you add.

**Verification.** This bug reproduces only against a real cluster with a credential-less sandbox, so plan for a dev-cluster pass (`cluster-ops` skill), not just unit tests. Traps:

- Dev app is **`http://localhost:4444`** — https 404s at Traefik.
- The UI **service worker serves a stale bundle** after a build; check the loaded script before concluding your change didn't apply.
- Another worktree's vite may own 5173, so `ui:run` lands on 5174 and localhost:5173 serves a different branch.
- A stale api-server is the usual cause of "missing field" symptoms — `cluster:build-apiserver`; note `cluster:build-agent` can roll the api-server back to a pre-branch pod.
- To reproduce faithfully you need a sandbox with **no** connections plus a private/unreachable GitHub source. Build that fixture first — it is the long pole, and a sandbox that already has a GitHub connection will not show the bug.

---

## 6. The schedule, honestly — raise this on day one

The epic gained **two** sub-issues after the Monday target was set: #3236 (filed 2026-08-07) and **#3208 "Rebuild the Skills surface on the new design"** (filed 2026-08-06). #3208 is a full visual and interaction rework, and its own scope statement gates it: *"once the design lands and the backend issues are done."* A redesign added two days before the deadline moves the deadline — that is a scope change, not a delivery slip, and it should be said plainly rather than absorbed.

Realistic sequencing from here:

1. **Merge #3203** — #2824 is done and blocked only on review. Takes the epic to 6 of 10.
2. **#3236** — this plan. Small, self-contained, and the mapping survives the redesign, so it is not wasted work.
3. **#3023 — replan against the #3208 prototype.** The prototype now exists (linked from #3208). Its search and bulk-select affordances should be designed once, in the new surface, rather than built in the old layout and then rebuilt. This is a change from the earlier advice, and the reason is that the prototype did not exist when that advice was given. The "carry a selection to a new sandbox" bullet is still unready — two unresolved questions in the issue and no skills field in the wizard snapshot — and should still be split into its own post-deadline issue.
4. **#3208 last**, per its own scope statement.
5. **#2654 — detach.** Unchanged recommendation: only remaining item needing its own migration, spans agent-runtime + api-server + UI, its skills half already works, and its real subject is the model — a harness-config concern gating nothing else in this epic. It was motivated by #2124, which shipped and closed on 2026-07-30 without it.

That is a two-week epic from here, not a two-day one. The decision the owner actually faces is whether #3022 closes Monday on the *original* scope — with #3208, #3023 and #2654 moved out to a follow-up epic — or stays open until the redesign lands. Both are defensible; drifting into the second by default is not.

---

## 7. Start here

1. Confirm #3203 is merged; branch from `main` after it is.
2. Reproduce the bug on the dev cluster using the issue's steps, and **pin the exact throw site** (§3) before writing any plan.
3. Get the owner's answers to §4.
4. Run `plan-feature` on #3236. One slice is likely honest here; two at most (classify, then the named message). Resist inflating it.
