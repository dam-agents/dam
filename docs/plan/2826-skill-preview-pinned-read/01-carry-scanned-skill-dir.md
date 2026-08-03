# 01 — Carry each scanned skill's repo directory

**Part of:** #2826 — see [README](./README.md)

## Context

The public archive scan walks the repo, finds each skill directory, and computes its repo-relative path as `rel` — then builds a result object that leaves `rel` out ([`public-archive-scanner.ts:222`](../../../packages/api-server/src/modules/skills/infrastructure/public-archive-scanner.ts:222)). Everything downstream that needs to know *where* a skill lives therefore either re-derives it by downloading the repo again (slice 02's problem) or guesses (this slice's problem: the modal's GitHub link). This slice puts the directory on the contract so both stop.

It is a producer-side change with one user-visible fix of its own — the "View SKILL.md on GitHub" link stops being wrong for `.claude/skills/` and `.agents/skills/` layouts — and it is what slice 02 consumes.

## Implementation plan

Apply the `/typescript-engineering` skill for the contract and api-server work, and `/react-ui-engineering` for the modal.

### 1. Add `dir` to the Scanned Skill contract

[`packages/api-server-api/src/modules/skills/schemas.ts`](../../../packages/api-server-api/src/modules/skills/schemas.ts:36) — extend `skillSchema` with an optional field, following the existing comment idiom in this file:

```ts
/** Repo-relative directory the skill was found in, whichever Source Root it
 *  came from — what a raw-file URL needs. Optional: the agent-runtime clone
 *  scan (private / non-GitHub sources) doesn't report it. */
dir: z.string().optional(),
```

**Optional, deliberately.** `agent-runtime-api`'s `ScannedSkill` ([`types.ts:21`](../../../packages/agent-runtime-api/src/modules/skills/types.ts:21)) is a separate interface, so the private scan path compiles and behaves unchanged with `dir` absent. Do **not** widen `ScannedSkill` in this slice — that belongs to #2824.

Keep the distinction from `skillSourceSchema.path` clear in the comment: `path` is the source's subdir, `dir` is this skill's actual directory. See the README's glossary.

### 2. Stop discarding `rel` in the public scan

[`public-archive-scanner.ts:216-227`](../../../packages/api-server/src/modules/skills/infrastructure/public-archive-scanner.ts:216) — the `skillDirs.map` callback already binds `rel`; return it:

```ts
return {
  source: gitUrl,
  name: fm.name?.trim() || path.basename(rel),
  description: fm.description?.trim() || "",
  version,
  contentHash,
  dir: rel,
};
```

Nothing else changes on the server. `dedupeByName` and the sort are unaffected, and the result flows into the existing 5-minute `(gitUrl, path)` scan cache ([`compose.ts:39`](../../../packages/api-server/src/modules/skills/compose.ts:39)) automatically — the cache stores `Skill[]`, so it carries the new field with no cache work.

`findSkillDirs` returns paths already relative to `repoDir` ([`skillDirsUnder`](../../../packages/api-server/src/modules/skills/infrastructure/public-archive-scanner.ts:161) does `path.relative(repoDir, dir)`), so `rel` is exactly the repo-relative directory with no adjustment needed — including when the source sets `path`, where `rel` already includes that prefix.

### 3. Prefer the real directory in the modal

[`skill-render-modal.tsx:36-40`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-render-modal.tsx:36) currently reads:

```tsx
// Prefer the exact directory the content read resolved; before it loads (or
// for a private source that can't be read) fall back to guessing the dir
// from the source path + skill name — best-effort, may 404 if they diverge.
const dir = data?.dir ?? `${source.path ?? "skills"}/${skill.name}`;
```

The scanned skill now knows its directory, so it takes precedence over both the content read and the guess:

```tsx
// The scan reports each skill's real directory, so the link is right before
// the content query resolves. The guess is the private-source fallback only —
// there the scan comes from agent-runtime, which doesn't report `dir`.
const dir =
  skill.dir ?? data?.dir ?? `${source.path ?? "skills"}/${skill.name}`;
```

Keeping `data?.dir` in the chain preserves today's behavior for any case where the scan lacks `dir` but the content read succeeds; keeping the guess last preserves the private-source fallback. The `gitBlobUrl(source.gitUrl, skill.version, …)` call on the next line is unchanged — it already pins to the scanned SHA, which is the semantic slice 02 makes the content agree with.

### 4. De-transcribe the Scanned Skill definition

[`docs/architecture/skills.md:79`](../../architecture/skills.md) currently transcribes the field tuple:

> A **Scanned Skill** is what an api-server scan returns from a Source: `(name, description, version, contentHash)`, where `version` is the source's HEAD commit SHA and `contentHash` is a deterministic SHA-256 over the skill directory.

Appending `dir` to that tuple would be the wrong fix — [documentation-guidelines.md:42](../../guidelines/documentation-guidelines.md:42) says a page describes a protocol semantically and links out to the contract package as the field-level source of truth, precisely so it "never drifts when those fields change". Rewrite it to describe the concept and what each part *means*, without the field list: what a scan reports about one skill in a Source — its identity, a `version` that is the source's HEAD commit SHA, a `contentHash` that is a deterministic SHA-256 over the skill directory (which is what drift detection compares), and where in the repo it was found — with the field-level shape pointed at [`packages/api-server-api/`](../../../packages/api-server-api/).

Do **not** bump `Last verified:` here; slice 02 also edits this page and bumps it once.

Check the surrounding paragraphs while editing: the Installed Skill Ref definition on the next line references "which Scanned Skill", and the [Source Roots](../../architecture/skills.md) section already explains where skills are found. Do not duplicate that explanation into the concept definition — link or lean on it.

### 5. Fix and check

```bash
mise run fix && mise run check
```

### 6. No new test, and why

Deliberate. There is nothing to extend: [`skills-scan-errors.test.ts`](../../../packages/api-server/src/__tests__/unit/skills-scan-errors.test.ts) covers only `privateScanErrorToTrpc`, and no test asserts the scanner's output shape. A test that the scanner returns `dir: rel` would restate the one-line diff; the smoke test below proves it against a real repo, which a unit test with a synthesized tarball would not. Flagging the call explicitly rather than skipping it silently.

## Acceptance criteria

- [ ] `skillSchema` carries `dir` as optional, with a comment distinguishing it from `skillSourceSchema.path`.
- [ ] `scanPublicGithubArchive` returns `dir` for every skill, equal to the repo-relative directory it was found in — including under a source that sets `path`, and for skills found under any Source Root.
- [ ] `agent-runtime-api`'s `ScannedSkill` is **unchanged**, and the private/non-GitHub scan path still compiles and behaves identically with `dir` absent.
- [ ] The modal's GitHub link uses `skill.dir` when present, falling back to the content read's `dir` and then the guess.
- [ ] `docs/architecture/skills.md`'s Scanned Skill definition no longer transcribes a field tuple and points at the contract package instead. `Last verified:` is **not** bumped in this slice.
- [ ] `mise run check` and `mise run test` pass. No new test files.
- [ ] `getSkillContent` and the tarball read path are **untouched** — those are slice 02.

## Smoke test

Existing suites first:

```bash
mise run check && mise run test
```

Then verify the link fix against a real repo — this is the part a unit test can't do. Needs the cluster up (`cluster-ops` skill) and a **public** GitHub source with **no explicit `path`** whose skills live under `.claude/skills/` or `.agents/skills/`, not top-level `skills/`. That layout is what makes the old guess wrong. (`https://github.com/anthropics/skills`, the example at [`values.yaml:1429`](../../../deploy/helm/platform/values.yaml:1429), is a public candidate — check its actual layout first.)

1. `mise run cluster:status` — confirm the cluster is up.
2. `mise run ui:run`, open **http://localhost:5173**. Vite proxies `/api` to `http://localhost:4444` ([`vite.config.ts:44`](../../../packages/ui/vite.config.ts:44)) — note the cluster serves **http**, not https. This picks up UI edits on save; the api-server change needs `mise run cluster:build-apiserver`.
3. `mise run cluster:build-apiserver` to load the scanner change, then open a sandbox → **Skills** and add the source.
4. Expand the source so its skills list. Click a skill name to open the preview, and hover/inspect the header's GitHub link: it must point at the **real** directory (e.g. `.claude/skills/<name>/SKILL.md`), not `skills/<name>/SKILL.md`.
5. Confirm the link is correct **immediately** — while the body is still showing the loading skeleton, before the content query resolves. That is the behavior `skill.dir` adds over `data?.dir`.
6. Regression check on the private path: add a non-`github.com` source (e.g. a `github.ibm.com` URL) against a running sandbox. Its list still scans through the pod, and clicking a skill still falls back to the GitHub link with the "preview isn't available" body — unchanged from `main`.

The implementing agent runs this itself, then prints a short manual guide so the owner can repeat steps 4–6 by hand.
