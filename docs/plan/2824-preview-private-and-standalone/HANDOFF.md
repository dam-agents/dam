# Handoff — plan #2824, inside epic #3022

**Written:** 2026-08-06. **Author:** session tracking epic #3022 since triage.
**Your job:** run `plan-feature` on **[#2824 — Preview a skill's SKILL.md in-product for private sources and standalone skills](https://github.com/dam-agents/dam/issues/2824)**. Nothing else.

Owner: Petr (@PetrBulanek). Epic #3022 must close **Monday 2026-08-10** — that is **two working days** from now. #2824 is the last remaining item that fits in the time; see §6 for what must be descoped.

---

## 1. Epic state — 4 of 8 closed, 2 PRs approved and waiting

| Issue | State |
|---|---|
| #2825 delete/download standalone | closed — gave us `skills.readLocal` |
| #2828 system vs. user provenance | closed — gave us the built-in group + `origin` |
| #2826 preview perf | **closed** — PR #3129 merged (`f2d028ce`) |
| #3019 publish badge | **closed** — PR #3139 merged (`5ea02ef1`) ⚠️ see below |
| #2827 last-scanned | implemented — **PR [#3178](https://github.com/dam-agents/dam/pull/3178) approved + green, awaiting merge** |
| **#2824 preview private + standalone** | **← plan this** |
| #3023 search / bulk / reuse | open — needs splitting + design (§6) |
| #2654 cache agent-resolved settings | open — recommend detaching (§6) |

⚠️ **#3019 is closed but not yet delivered.** PR [#3182](https://github.com/dam-agents/dam/pull/3182) (approved + green, awaiting merge) reports that the pr-state resolver on `main` is **dead** — the candidate query passes a `Date` into a raw ``sql`` `` template, which throws at `Bind` on every tick, so no badge ever resolves. Until #3182 merges, the badge permanently reads "Submitted". Both open PRs are `MERGEABLE / CLEAN / APPROVED` with all checks green; they overlap only on `docs/architecture/skills.md`. Merge **#3182 first**, then #3178.

**Base your branch on `main` after both land.** #3182 touches `local-skill-repository.ts` (agent-runtime) and #3178 touches `skills-service.ts` / `compose.ts` — both areas you will be in.

---

## 2. What #2824 asks for

Clicking a skill name opens an in-product `SKILL.md` view — but only for **public** GitHub sources. Private/enterprise sources fall back to a "View on GitHub" link, and **standalone** skills created in the sandbox do nothing at all when clicked. A user can't read what these skills do without leaving the product, or can't read them at all.

The issue's stated dependency ("needs backend content-read support for private sources and local skills") is **half stale** — the local-skills backend shipped with #2825. See §3.

The two halves are independent and should be separate slices, in this order.

---

## 3. Half A — standalone skills (small; everything is already on the wire)

**The backend is done.** `skills.readLocal` exists end to end and the UI already calls it for the download action ([`use-skills-surface.ts:353`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts)). It returns:

```
{ dir: string, files: [{ relPath, content, base64?: true }] }
```

So a preview is: call `readLocal`, pick the entry whose `relPath` is `SKILL.md`, render `content` through the existing `<Markdown>` component. No new endpoint, no contract change.

What's actually missing is UI:

1. **The name isn't clickable.** [`standalone-skill-row.tsx:91`](../../../packages/ui/src/modules/sandboxes/components/skills/standalone-skill-row.tsx) renders a plain `<p>`. The source-skill row already has the affordance to copy — see `onOpen` in [`skill-row.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-row.tsx).
2. **`SkillRenderModal` is hard-coupled to a source.** [`skill-render-modal.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-render-modal.tsx) takes `{ source: SkillSource, skill: Skill }` and always queries `getSkillContent`. A standalone skill has no source and no `version`, so the GitHub-link accessory and the `dir` guess are meaningless for it. Decide deliberately: a discriminated prop on the one modal, or a sibling component sharing the `<Markdown>` body. Prefer whichever keeps the modal's header/skeleton/error markup in one place.

⚠️ **Read the row component fresh before planning.** #3139 rewrote this area — `standalone-skills-group.tsx` was restructured and `standalone-skill-row.tsx` is a new file with pill states, a `Publish again` path and a `Track from {source}` action. Do not plan against the pre-#3139 markup.

### Scope question for the owner

[`built-in-skills-group.tsx:45`](../../../packages/ui/src/modules/sandboxes/components/skills/built-in-skills-group.tsx) — image-baked skills also render a non-clickable `<p>`. They are Local Skills too, so `readLocal` resolves them by name for **nearly zero extra cost**, and "every visible action does something" arguably covers them. The issue title says only "private sources and standalone skills". Ask whether to include; it is a cheap consistency win, and the answer changes one slice's scope, not its shape.

---

## 4. Half B — private sources (needs one new agent-runtime read)

`getSkillContent` on `main` has **three** `NOT_IMPLEMENTED` gates ([`skills-service.ts:399-439`](../../../packages/api-server/src/modules/skills/services/skills-service.ts)):

1. the host isn't GitHub,
2. the cached scan has no `dir` — which is how a private repo presents, because the archive 404s and the scan falls through to the pod, and **the agent-runtime clone scan doesn't report `dir`**,
3. the public archive 404s on a cold cache.

**The precedent you should follow already exists.** #3139 added `readPullRequest` to the agent-runtime skills router ([`router.ts:113`](../../../packages/agent-runtime-api/src/modules/skills/router.ts)) plus [`pod-pr-state-reader.ts`](../../../packages/api-server/src/modules/skills/infrastructure/pod-pr-state-reader.ts) — a working "api-server asks the pod to read GitHub through the credential-injecting gateway" path. A private SKILL.md read is the same shape against a different endpoint. Note `raw.githubusercontent.com` already has its own Envoy filter chain injecting the owner's token ([`catalog.ts:715`](../../../packages/api-server/src/modules/connections/domain/catalog.ts)), so the pod can fetch one pinned file exactly as the api-server does for public sources.

**The design decision that shapes this slice:** gate 2 exists only because the pod scan omits `dir`. Two routes —

- **(a) Make the agent-runtime scan report `dir` too**, then a private preview is the same "read one pinned file" as the public path, just issued from the pod. Removes gate 2 permanently and keeps one mental model. `dir` is already optional on `skillSchema` (#3129 added it with a comment naming this exact gap).
- **(b) Have the pod resolve name → directory at read time**, re-fetching the source. Simpler contract, but re-introduces the per-preview repo fetch that #2826 just removed — on the *private* path.

Recommend (a); verify against the code and state the choice in the plan.

### The waking question — decide it explicitly

#3139 deliberately **never wakes** a hibernated pod, because a badge is not worth spending the user's compute on something they didn't ask for. **A preview is different: the user clicked it.** `getSkillContent` already accepts `agentId`, and sibling read paths (`readLocal`, `scan`, `install`) all go through `ensureAgentReachable`, which wakes. So waking is probably right here — but it is the opposite of the policy the neighbouring code just established, so it must be a stated decision, not an accident, and it belongs in [`docs/architecture/skills.md`](../../architecture/skills.md) alongside the badge's "never wakes" rule.

---

## 5. Conventions and verification

- **`mise` is the only task runner.** Never call `pnpm`/`go`/`kubectl`/`helm` directly. `mise run lint:fix` after UI edits.
- **Read [`docs/architecture/skills.md`](../../architecture/skills.md) first** — source of truth, not the code. § api-server skills service documents the `getSkillContent` deferral you are removing; § agent-runtime skills service lists the pod's endpoints. Both need updating, plus `Last verified:`. Do not read ADRs.
- **Skills:** `react-ui-engineering` for the UI slice, `typescript-engineering` for the api-server/agent-runtime slice.
- **Planning writes only uncommitted markdown** under `docs/plan/2824-preview-private-and-standalone/`. Planning sessions never touch tracked files. CI gate `no docs/plan in merge result` enforces the plan never reaches the merge result — #2827 handled this with a `chore(plan): drop …` commit before merge; follow that pattern.
- **Commits:** Conventional Commits, `git commit -s`, no mention of Claude/Anthropic/AI, no Co-Authored-By. PR title is Conventional Commits too. Branch `feat/2824-preview-private-and-standalone`.
- **Check `git branch --show-current` immediately before committing** — concurrent sessions share this checkout and move HEAD.
- **Comments sparingly**; **prefer removing tests over adding**. Half A is UI wiring over an existing endpoint and may not earn a new test; the private read path plausibly does. Decide and justify.

**Verification** is unit tests plus a manual pass on the local dev cluster (`cluster-ops` skill). Traps that cost hours:

- Dev app is served over **`http://localhost:4444`** — https 404s at Traefik.
- The UI **service worker serves a stale bundle** after a build; check the loaded script before concluding your change didn't apply.
- Another worktree's vite may own 5173, so `ui:run` lands on 5174 and **localhost:5173 serves a different branch**.
- A missing field usually means a **stale api-server** — `cluster:build-apiserver`. zod `.output()` silently strips fields an older api-server doesn't send. Also note `cluster:build-agent` can roll the api-server back to a pre-branch pod, which makes an agent-side change look broken.
- Testing Half B needs a **private** GitHub source plus a connected GitHub credential on a running sandbox — arrange that fixture before you start, it is the long pole.

---

## 6. Deadline reality — raise this with the owner on day one

Two working days remain and three issues are open. #2824 is the only one that fits. The other two need a decision **now**, not on Monday:

- **#2654 — detach from the epic.** Only remaining item needing its own migration; spans agent-runtime + api-server + UI; its skills half already works ([`skills-service.ts:631`](../../../packages/api-server/src/modules/skills/services/skills-service.ts) returns tracked refs while stopped). Its real subject is the model — a harness-config concern gating nothing else here. Motivated by #2124, which shipped and closed on 2026-07-30 without it.
- **#3023 — split.** Search is nearly free (every source is already eagerly scanned on mount, [`use-skills-surface.ts:194`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts)); bulk-toggle is medium; "carry a selection to a new sandbox" is not ready — two unresolved open questions in the issue, and [`wizard-snapshot.ts`](../../../packages/ui/src/modules/sandboxes/lib/wizard-snapshot.ts) has no skills field at all. That third bullet should become its own post-deadline issue.

**Sequence Half A before Half B and make them separate commits.** Half A is a few hours and ships value on its own; if Friday runs out, the epic still gains the standalone preview instead of a half-finished private path.

---

## 7. Start here

1. Confirm #3182 and #3178 are merged; branch from `main` after they are.
2. Read [`docs/architecture/skills.md`](../../architecture/skills.md) § api-server skills service, § agent-runtime skills service, § Credential injection on the wire.
3. Read the **current** `standalone-skill-row.tsx`, `standalone-skills-group.tsx` and `skill-render-modal.tsx` — #3139 and #3129 changed all three.
4. Get the owner's answers on the built-in-skills scope question (§3) and the waking policy (§4), then run `plan-feature` on #2824. Two slices — standalone, then private — is the honest decomposition.
