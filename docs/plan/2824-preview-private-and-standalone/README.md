# Preview a skill's SKILL.md in-product for private sources and standalone skills

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** [#2824](https://github.com/dam-agents/dam/issues/2824) (epic [#3022](https://github.com/dam-agents/dam/issues/3022))

## Goal

Clicking a skill's name opens its `SKILL.md` in-product. Today that works only for skills
from **public** GitHub sources: a private/enterprise source falls back to a "View on GitHub"
link, and a **standalone** skill created in the sandbox does nothing at all when clicked.

After this feature, every skill name on the Skills surface opens a readable preview —
standalone, image-baked, public-sourced, and private-sourced alike. The one remaining
exception is a **non-GitHub** source (self-hosted GitLab and friends), which stays deferred;
see [Scope](#scope).

## Approach

Two independent halves, and they are independent for a reason: the standalone half needs no
backend work at all, so it ships value on its own even if the private half runs out of runway.

**Half A — standalone and image-baked skills (UI only).** The backend already exists.
`skills.readLocal` is wired end to end and the UI already calls it for the download action
([`use-skills-surface.ts:363`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts)),
returning `{ dir, files: [{ relPath, content, base64? }] }`. A preview is therefore: call
`readLocal`, take the entry whose `relPath` is `SKILL.md`, render `content` through the existing
`<Markdown>` component. No new endpoint, no contract change. What's missing is purely UI — the
name isn't a button, and `SkillRenderModal` is hard-coupled to a `SkillSource`.

**Half B — private GitHub sources (agent-runtime + api-server).** `getSkillContent` carries
three `NOT_IMPLEMENTED` gates today
([`skills-service.ts:402-466`](../../../packages/api-server/src/modules/skills/services/skills-service.ts)):
the host isn't GitHub; the cached scan reports no `dir`; the public archive 404s on a cold
cache. Gates 2 and 3 both exist only because the private path has no way to read one file
through the pod. This half builds that path and both gates go away.

It follows the precedent #3139 established for the publish badge: the api-server asks the
agent's own pod to read GitHub, and the pod's paired gateway injects the owner's token on the
wire — see [`skills.md` § Credential injection on the wire](../../architecture/skills.md).
`readPullRequest` ([`router.ts:113`](../../../packages/agent-runtime-api/src/modules/skills/router.ts))
is the shape to copy; the new endpoint is the same thing against a different GitHub endpoint.

Architecture pages this feature changes: [`docs/architecture/skills.md`](../../architecture/skills.md)
(§ api-server skills service, § agent-runtime skills service, § Skill / Scanned Skill).

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | [Preview a standalone or image-baked skill](./01-standalone-and-builtin-preview.md) | UI only. Clickable name on standalone + built-in rows; a `readLocal`-backed preview modal sharing one shell with the source-backed one. | — |
| 02 | [Preview a private GitHub source's skill](./02-private-source-preview.md) | Vertical. Pod scan reports `dir`; new pod `readSkillFile`; api-server dispatch + gate removal; architecture doc. | — |

Technically independent — 02 does not need 01. **Implement 01 first anyway:** it is a few
hours and delivers half the issue on its own, whereas 02 needs a private-repo fixture with a
connected GitHub credential on a running sandbox, which is the long pole.

## Decisions

Settled with the owner before planning. Each one was a live fork; recording them so the
implementing agent doesn't re-open them.

**Image-baked skills are in scope.** The issue title names only private sources and standalone
skills, but [`built-in-skills-group.tsx:45`](../../../packages/ui/src/modules/sandboxes/components/skills/built-in-skills-group.tsx)
renders the same inert `<p>`. Built-ins are Local Skills, so `readLocal` resolves them by name
through the identical code path — about ten extra lines for the consistency win that every
visible skill name opens something.

**`dir` comes from the pod scan (route a), not from a read-time re-resolve (route b).** Both pod
scan paths already hold the repo-relative directory as `rel` and drop it on the floor
([`scan.ts:143-153`](../../../packages/agent-runtime/src/modules/skills/services/scan.ts) and
[`scan.ts:116-128`](../../../packages/agent-runtime/src/modules/skills/services/scan.ts)), so
reporting it is a few lines. Route (b) — have the pod resolve name → directory at read time —
would re-introduce the per-preview repo fetch #2826 just removed, on the private path. Route (a)
also keeps one mental model: a preview is "read one pinned file at a known dir", whoever issues
it. `dir` is already optional on api-server's `skillSchema` (#3129 added it naming this exact
gap), and the client's `scan` is a pass-through cast, so nothing in between needs a mapping
change.

**The pod reads through the GitHub Contents API, not `raw.githubusercontent.com`.** Both work —
`raw.githubusercontent.com` has its own Envoy filter chain injecting the owner's token
([`catalog.ts:715`](../../../packages/api-server/src/modules/connections/domain/catalog.ts)) — but
the pod's client is deliberately "a thin port over `api.github.com`"
([`github-rest-client.ts:80`](../../../packages/agent-runtime/src/modules/skills/infrastructure/github-rest-client.ts)),
and adding a second host to it would widen that contract. `GET /repos/{o}/{r}/contents/{dir}/SKILL.md?ref={sha}`
stays on the host every other pod read already uses, reuses the existing `ghJson` error mapping
(which is what produces the structured `app_not_connected` / `access_restricted` CTAs the UI
renders), and mirrors `getPullRequest`'s authenticated-by-default shape.

**The private preview wakes a hibernated sandbox.** This is deliberately the *opposite* of the
policy #3139 established one file over, and the difference is who asked: a badge resolves in the
background, so spending the user's compute on it is unasked-for, whereas a preview happens
because the user clicked. `getSkillContent` already accepts `agentId`, and every sibling read
path (`readLocal`, `scan`, `install`) goes through `ensureAgentReachable`, which wakes. Because
this contradicts the neighbouring rule, it must be **stated in `skills.md`** next to the badge's
never-wakes rule, not left implicit in the code.

**The scan cache is credential-scoped, and the preview inherits that.** Added by
[#3198](https://github.com/dam-agents/dam/pull/3198) after this plan was first written:
`scanSource` now takes a `ScanScope` as its **first** argument — `{ kind: "shared" }` for an
uncredentialed scan, `{ kind: "owner", owner }` for one that ran under a user's access — and the
scope is part of the cache key ([`scan-cache.ts`](../../../packages/api-server/src/modules/skills/infrastructure/scan-cache.ts)).
Two consequences for slice 02, both load-bearing:

- **The scope arguments must survive the refactor.** Slice 02 extracts `list`'s scan dispatch
  into a shared helper. Dropping or defaulting a scope while moving that code would put one
  user's private skill list back in reach of another — a regression of a security fix, not a
  style slip.
- **Provenance is now knowable, so the file read dispatches on it.** An earlier draft of this
  plan argued the opposite: that a warm cache entry from a pod scan could answer the public
  branch, so only a 404 could tell a private source from a public one. Scoping makes that
  impossible — a `shared` lookup can never be served an `owner`-scoped entry. So the helper
  reports which branch it took and the file read follows it, instead of spending a throwaway
  public request to discover what the scan already knew.

**Half A reuses `readLocal` as-is.** `readLocal` returns *every* file in the skill under a 5 MB
total / 2 MB per-file cap
([`local-skill-repository.ts:20`](../../../packages/agent-runtime/src/modules/skills/infrastructure/local-skill-repository.ts)),
where a preview needs only `SKILL.md`. Adding an optional single-file filter would be more
correct, but it grows slice 01 from one package to four and forces an agent-pod rebuild to
verify. Reuse keeps 01 pure UI. Consequence to accept: a standalone skill over the cap gets
`PAYLOAD_TOO_LARGE` and the modal's error state instead of a preview. Rare — most standalone
skills are a single `SKILL.md` written by `writeLocal` or authored in place. A filter stays purely
additive if it's ever needed.

## Scope

**Out of scope: non-GitHub sources.** Gate 1 of `getSkillContent` — `if (!detectHost(src.gitUrl))`
— survives this feature. The Contents API is GitHub-only, and reading one file out of a
self-hosted GitLab source would mean another `git clone` per preview, which is precisely the cost
#2826 removed. Slice 02 removes gates 2 and 3 (the `dir`-less scan and the cold-cache archive
404) and leaves gate 1 in place with a message that names the host rather than claiming "private
sources aren't supported yet". Both the issue and this plan read "private source" as "private
**GitHub** source", which is what the product's sources are in practice.

## Conventions & glossary

- **`mise` is the only task runner.** Never invoke `pnpm`, `go`, `kubectl`, or `helm` directly.
  Run `mise run lint:fix` after UI edits (it fixes import order and `import type`), then
  `mise run check`.
- **Read [`docs/architecture/skills.md`](../../architecture/skills.md) before changing behavior** —
  it is the source of truth, not the code. Do not read ADRs.
- **Skills to apply:** `/react-ui-engineering` for slice 01,
  `/typescript-engineering` for slice 02 (both packages).
- **Tests: prefer reduction over addition.** Neither slice is asked to author new tests.
  Verification is the existing suite (`mise run check`, `mise run test`) plus the manual smoke
  test in each slice. Slice 02 names one narrow exception and its trigger.
- **Commits:** Conventional Commits, `git commit -s`, no Co-Authored-By and no mention of
  Claude/Anthropic/AI. One atomic commit per slice. Check `git branch --show-current`
  immediately before committing — concurrent sessions share this checkout and move `HEAD`.

Glossary (full definitions in [`skills.md` § Concepts](../../architecture/skills.md#concepts)):

- **Local Skill** — a directory present in a Skill Path on the pod, however it got there.
  Splits into **Installed** (tracked in `agent_skills`) and **Standalone** (untracked).
- **Skill Origin** — `system` / `system-modified` / `user`, judged at read time against the
  image's pristine roots. The UI's "Included with sandbox image" group is the `system*` ones.
- **Scanned Skill** — what a scan reports about one skill in a Source: `name`, `description`,
  `version` (the source's HEAD SHA), `contentHash`, and `dir` (repo-relative directory).
- **Source Roots** — the ordered set `skills/`, `.claude/skills/`, `.agents/skills/`, unioned
  then deduped by name, with top-level `*` as a fallback only.

### Dev-cluster traps that cost hours

- The dev app is served over **`http://localhost:4444`** — `https` 404s at Traefik.
- The UI **service worker serves a stale bundle** after a build. Check the loaded script before
  concluding a change didn't apply.
- Another worktree's vite may own 5173, so `ui:run` lands on 5174 and **localhost:5173 serves a
  different branch**.
- A field arriving as `undefined` is usually a **stale api-server**, not a bug: zod `.output()`
  silently strips fields an older api-server doesn't send. Rebuild with
  `cluster:build-apiserver`. Note `cluster:build-agent` can leave a *pre-branch* api-server pod
  running, which makes an agent-side change look broken.
- Use the [`cluster-ops`](../../../.claude/skills/cluster-ops/SKILL.md) skill for cluster and
  cert failures.

## Whole-feature smoke test

On the local dev cluster with a running sandbox, at `http://localhost:4444`, open a sandbox's
Skills panel and click **every** skill name on the page:

1. A skill under **Created in this sandbox** → modal opens, `SKILL.md` renders as markdown.
2. A skill under **Included with sandbox image** → same.
3. A skill from a **public** GitHub source → renders as before (no regression), and the
   header's GitHub link still points at the right blob.
4. A skill from a **private** GitHub source, with a GitHub credential connected → renders,
   instead of the "isn't available yet" fallback.
5. Stop the sandbox: rows are non-interactive (the surface is `pointer-events-none` when
   `readOnly`), so no preview is reachable and nothing throws.
6. With the sandbox **hibernated**, click a private source's skill → the sandbox wakes and the
   preview renders (the decision above, made visible).

Then `mise run check` and `mise run test` green.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
[#2824](https://github.com/dam-agents/dam/issues/2824).

**Branch base — unblocked.** Re-verified 2026-08-06: both prerequisites merged, plus one PR this
plan didn't originally anticipate. `main` is at `a11d7fc2`; branch from it directly.

| Merged | What it changed under our feet |
|---|---|
| [#3182](https://github.com/dam-agents/dam/pull/3182) `981a15d7` | pr-state resolver repair. Touches `local-skill-repository.ts`, which slice 02 edits (it exports `subPathEscapes`). |
| [#3178](https://github.com/dam-agents/dam/pull/3178) `be56d34a` | `scannedAt`. `scanSource`/`skills.list` now return `{ skills, scannedAt }`; the cache moved out of `compose.ts` into `infrastructure/scan-cache.ts`. |
| [#3198](https://github.com/dam-agents/dam/pull/3198) `b9867998` | **Not in the original plan.** Credential-scoped scan cache — see the decision above. Adds a `ScanScope` first argument to `scanSource` and a security log in the `!skill.dir` branch slice 02 rewrites. |

Line references in the slice files were re-verified against `a11d7fc2`.

`docs/plan/` must not reach the merge result — the `Plan check` CI job fails while the folder
exists. Drop it in a final `chore(plan): drop 2824-preview-private-and-standalone` commit before
the PR is marked ready, as #2827 did.
