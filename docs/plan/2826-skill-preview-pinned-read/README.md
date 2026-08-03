# Skill preview reads one pinned file instead of the repo tarball

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** [#2826](https://github.com/dam-agents/dam/issues/2826)
**Epic:** [#3022 — Close the Skills usability gaps](https://github.com/dam-agents/dam/issues/3022)

## Goal

Opening a skill's in-product preview downloads and extracts the source repo's entire `archive/HEAD.tar.gz` — on every open, including reopening the same skill. On a large catalog repo that is a visible lag on an action that should feel instant. The waste is avoidable: the scan that populated the list already walked the repo and knew exactly which directory each skill lives in, then discarded it.

After this change the catalog contract carries each scanned skill's repo-relative directory, and preview fetches exactly one file — `raw.githubusercontent.com/{owner}/{repo}/{sha}/{dir}/SKILL.md`.

There is a second, less obvious outcome, and it is a correctness fix rather than a speed one. The modal's "View SKILL.md on GitHub" link is currently a **guess**: `${source.path ?? "skills"}/${skill.name}` ([`skill-render-modal.tsx:39`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-render-modal.tsx:39)), whose own comment concedes it "may 404 if they diverge". It diverges for every source with no explicit `path` whose skills live under `.agents/skills/` or `.claude/skills/` — a layout this repo itself uses. Carrying `dir` makes that link right, and right *immediately*, before the content query resolves.

## Approach

Two steps, in order:

1. **`dir` joins the Scanned Skill contract.** [`scanPublicGithubArchive`](../../../packages/api-server/src/modules/skills/infrastructure/public-archive-scanner.ts:222) already computes each skill's repo-relative directory as `rel` and drops it when building the result object; it starts returning it as `dir`. It rides the existing 5-minute `(gitUrl, path)` scan cache with no cache changes ([`compose.ts:39`](../../../packages/api-server/src/modules/skills/compose.ts:39)).
2. **`getSkillContent` stops re-fetching the repo.** It resolves `{version, dir}` for the requested skill from that cached scan, then GETs the one pinned file. The tarball-based `readPublicGithubSkill` is deleted — it has exactly one caller chain and no test references, so nothing else depends on it.

**Why the cached scan is the right source for `{version, dir}`, rather than accepting them from the client:** it keeps the tRPC input unchanged, keeps a client-supplied string out of a URL path, and — decisively — the scan is *structurally already warm*. A preview is reachable only by clicking a skill name inside a source card, and [`use-skills-surface.ts:194`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts:194) eagerly loads every source's skills on mount. By the time a name exists to click, that source's scan is cached. So the common path costs **zero tarballs**, not "one fewer".

### Decisions taken

Each of these was checked against the code rather than assumed; they are settled, and the slices should not re-open them.

- **Pinned to the scanned `version`, not upstream HEAD.** Not really a new semantic: the modal already pins its GitHub link to `skill.version` ([`skill-render-modal.tsx:40`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-render-modal.tsx:40)), and that is the SHA drift detection compares against. Reading content at HEAD would let the rendered markdown disagree with the link inches away in the same header. Staleness is bounded by the 5-minute TTL and cleared by `sources.refresh`.
- **No new server-side content cache.** The pinned GET is a few KB, the scan cache already carries `dir`, and the preview query is cached client-side by TanStack Query ([`skill-render-modal.tsx:29`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-render-modal.tsx:29)) — that is what already makes repeat opens instant. A second cache would be redundant; the issue's "and reuse" is satisfied without one.
- **A cold cache still costs one scan, and that is accepted.** Reaching it requires listing, then idling past the TTL, then clicking without anything refreshing. The issue's complaint is reopening ("even reopening the same skill"), which goes to zero. This closes #2826 rather than partially addressing it. Persisting the scan is out of scope — that is #2827's question, and it carries a migration.
- **`dir` is optional on the contract.** `agent-runtime-api`'s `ScannedSkill` ([`types.ts:21`](../../../packages/agent-runtime-api/src/modules/skills/types.ts:21)) is a **separate interface** from api-server-api's `skillSchema`, so the private/clone scan path needs no change and simply leaves `dir` undefined. Precedent for putting it on the contract at all: `skillRefSchema.path` is already denormalized "so the apply path resolves the skill dir without re-reading the source" ([`schemas.ts:58`](../../../packages/api-server-api/src/modules/skills/schemas.ts:58)) — the same move, already accepted here.
- **Private and non-GitHub sources are untouched.** `detectHost` matches only `^https://github\.com/{owner}/{repo}$` ([`git-host.ts:15`](../../../packages/api-server/src/modules/skills/infrastructure/git-host.ts:15)), so enterprise hosts like `github.ibm.com` never reach this path and there is no enterprise-raw-host concern. They keep returning `NOT_IMPLEMENTED`. Extending preview to them is [#2824](https://github.com/dam-agents/dam/issues/2824), which needs an agent-runtime read routed through the pod for the credential swap — a different subsystem. Slice 01's `dir` is precisely the seam #2824 will consume; do not build any of it here.
- **A size guard on the pinned GET**, since `MAX_TARBALL_BYTES` no longer covers this path.

### Architecture doc

This feature changes documented behavior, so [`docs/architecture/skills.md`](../../architecture/skills.md) is updated in the same PR ([documentation-guidelines.md:61](../../guidelines/documentation-guidelines.md:61)). Two spots, one per slice, so the page is true as each slice lands:

- **Line 79** defines a Scanned Skill by transcribing its field tuple, `(name, description, version, contentHash)`. That transcription is *why* adding a field forces a doc edit at all, and [guideline line 42](../../guidelines/documentation-guidelines.md:42) says not to do it — "a reader who needs exact fields follows the link, and the page never drifts when those fields change." So slice 01 **de-transcribes** the definition rather than appending `dir` to the tuple, describing the concept semantically and pointing at the contract package. This retires the drift class instead of paying it again on the next field.
- **Line 128** says `getSkillContent` reads "through the same public-archive path via `readPublicSkill`", which slice 02 makes false. Slice 02 corrects it and bumps `Last verified:`.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | Carry each scanned skill's repo directory | Optional `dir` on `skillSchema`; the public archive scan stops discarding `rel`; the modal prefers `skill.dir` over its guess. De-transcribes the Scanned Skill definition. | — |
| 02 | Preview reads one pinned file, not the repo tarball | `getSkillContent` resolves `{version, dir}` from the cached scan and GETs the pinned `SKILL.md`; the tarball reader is deleted. Corrects the subsystem prose. | 01 |

Slice 01 is a producer-side change with its own user-visible fix (the link); slice 02 is the consumer that turns it into the speed win. Splitting this way gives a low-risk review checkpoint before the read path is rewritten, and each slice leaves the branch green with a concrete smoke test of its own.

## Conventions & glossary

- **Scanned Skill** — what an api-server scan returns for one skill in a Source. Carries the source's HEAD SHA as `version` and, after slice 01, the repo-relative directory as `dir`. Distinct from `agent-runtime-api`'s `ScannedSkill`, which is a separate interface on the pod side.
- **`dir` vs. `path`** — easy to confuse, and they are not the same. `path` is a property of the **Source**: an optional repo-relative subdir the scanner walks exclusively instead of the [Source Roots](../../architecture/skills.md) union. `dir` is a property of **one scanned skill**: the full repo-relative directory it was actually found in, whichever root that came from. When a source sets `path`, every `dir` sits under it — but `dir` is what a URL needs.
- **Source Roots** — the ordered set a scan unions over: `skills/`, `.claude/skills/`, `.agents/skills/`, with top-level `*` as a fallback only. Shared from `agent-runtime-api` so both scanners and the install resolver agree.
- Apply [`/typescript-engineering`](../../../.agents/skills/typescript-engineering/SKILL.md) for the api-server and contract work, and [`/react-ui-engineering`](../../../.agents/skills/react-ui-engineering/SKILL.md) for `packages/ui`. Each slice names which.
- **`mise` is the only task runner.** After edits run `mise run fix` (or the scoped `ui:fix` / `api-server:fix`), then `mise run check`. ⚠️ [`packages/ui/CLAUDE.md`](../../../packages/ui/CLAUDE.md) says `mise run lint:fix` — **that task does not exist**; the real ones are `<pkg>:fix` and the top-level `fix`.
- **Comments sparingly** — only the non-obvious *why*.
- **No new tests.** The only nearby suite is [`skills-scan-errors.test.ts`](../../../packages/api-server/src/__tests__/unit/skills-scan-errors.test.ts), which covers `privateScanErrorToTrpc` alone — nothing on the scanner's output shape or the content read. Both slices have concrete manual smoke tests instead. Reasoned per slice.
- **Never hardcode the brand.** Not in play here.

## Whole-feature smoke test

Needs one **public** GitHub skill source with **no explicit `path`** whose skills live under `.claude/skills/` or `.agents/skills/` rather than top-level `skills/` — that is the case where the old guessed link is provably wrong. (`https://github.com/anthropics/skills`, the example in [`values.yaml:1429`](../../../deploy/helm/platform/values.yaml:1429), is a public candidate; verify its layout before relying on it.)

With the cluster up (`cluster-ops` skill) and `mise run ui:run` open at **http://localhost:4444**'s proxied dev server (see slice 01):

1. Open a sandbox → **Skills**, add that source, and expand it so the skill list renders.
2. Click a skill name. The preview renders its `SKILL.md`, and the header's GitHub link resolves to the **real** path (`.claude/skills/<name>/SKILL.md`), not `skills/<name>/SKILL.md`.
3. Close and reopen the same skill, then open a different skill from the same source. Both are immediate, and `mise run cluster:logs` shows **no repeated archive fetch** — only scan-cache hits.
4. On a large source repo, compare the `getSkillContent` request duration in devtools against `main`: it drops from "download + extract the whole repo" to a single small file GET.

## Delivery

One atomic commit per sub-issue, two total. The feature lands as a single PR for [#2826](https://github.com/dam-agents/dam/issues/2826), titled per Conventional Commits (`perf(skills): …`). The cleanup commit deleting this folder is what clears the `Plan check` gate.
