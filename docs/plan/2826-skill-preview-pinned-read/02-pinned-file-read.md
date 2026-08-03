# 02 — Preview reads one pinned file, not the repo tarball

**Depends on:** 01-carry-scanned-skill-dir
**Part of:** #2826 — see [README](./README.md)

## Context

`readPublicGithubSkill` ([`public-archive-scanner.ts:258`](../../../packages/api-server/src/modules/skills/infrastructure/public-archive-scanner.ts:258)) downloads `archive/HEAD.tar.gz`, extracts it to a temp dir, walks the Source Roots, reads the matching `SKILL.md`, and deletes the temp dir — every single time a preview opens. It is the whole of #2826's slowness. With slice 01 putting `dir` on the scanned skill, the directory no longer has to be rediscovered, so the read collapses to one small pinned GET. This slice rewires `getSkillContent` and deletes the tarball reader.

## Implementation plan

Apply the `/typescript-engineering` skill. No UI change in this slice — the modal already renders `data.content` and got its link fix in slice 01.

### 1. Add a pinned raw-file reader

In [`public-archive-scanner.ts`](../../../packages/api-server/src/modules/skills/infrastructure/public-archive-scanner.ts), replace `readPublicGithubSkill` with a function that reads one file at a pinned SHA:

```ts
/** Read one skill's raw `SKILL.md` at a pinned commit, given the repo-relative
 *  directory the scan reported. One small GET — no tarball, no extraction.
 *  Throws `PublicArchiveNotFoundError` on 404 so the caller can't mistake a
 *  private repo for a missing skill. */
export async function readPublicGithubSkillFile(
  gitUrl: string,
  version: string,
  dir: string,
): Promise<string | null>;
```

Requirements:

- URL shape: `https://raw.githubusercontent.com/{owner}/{repo}/{version}/{dir}/SKILL.md`, with `owner`/`repo` from `detectHost` — the same guard `scanPublicGithubArchive` uses, throwing on a non-GitHub URL.
- `raw.githubusercontent.com` is correct for every source that reaches here: `detectHost` matches only `^https://github\.com/{owner}/{repo}$` ([`git-host.ts:15`](../../../packages/api-server/src/modules/skills/infrastructure/git-host.ts:15)), so enterprise hosts never arrive on this path.
- **Reject a `dir` that escapes**, reusing the existing `subPathEscapes` guard ([`:119`](../../../packages/api-server/src/modules/skills/infrastructure/public-archive-scanner.ts:119)) or an equivalent. `dir` is server-derived today, but the guard costs nothing and keeps the URL safe if a future caller passes something else.
- **Cap the response size.** `MAX_TARBALL_BYTES` no longer protects this path; add a `MAX_SKILL_MD_BYTES` (a `SKILL.md` is kilobytes — a low cap like 1 MB is generous) and fail rather than buffer an arbitrary response.
- `404` → `PublicArchiveNotFoundError`, so the caller keeps distinguishing "private repo" from "no such skill" exactly as today. Other non-OK statuses throw with the status, matching the scanner's idiom.

Then **delete** `readPublicGithubSkill` and its tarball/extract body. It has exactly one caller chain and no test references (verified: only [`compose.ts:9`](../../../packages/api-server/src/modules/skills/compose.ts:9), [`compose.ts:88`](../../../packages/api-server/src/modules/skills/compose.ts:88), and the service dep), so this is a clean removal, not a deprecation.

### 2. Rewire `getSkillContent`

[`skills-service.ts:388-424`](../../../packages/api-server/src/modules/skills/services/skills-service.ts:388). Keep the source resolution and the `!detectHost(...)` → `NOT_IMPLEMENTED` guard exactly as they are, then replace the `deps.readPublicSkill` call with: resolve the skill from the **cached** scan, then read the pinned file.

Reuse `list`'s scan expression verbatim so both share one cache entry ([`skills-service.ts:356`](../../../packages/api-server/src/modules/skills/services/skills-service.ts:356)):

```ts
const skills = await deps.scanSource(src.gitUrl, src.path, (gitUrl) =>
  deps.scanPublic(gitUrl, src.path),
);
const skill = skills.find((s) => s.name === name);
```

Then:

- **No match** → `NOT_FOUND`, same message as today.
- **Match without `dir`** → `NOT_FOUND` as well. Unreachable in practice (a `github.com` source is scanned by the public scanner, which always reports `dir` after slice 01), but it must not construct a URL from `undefined`.
- **Match** → `deps.readPublicSkillFile(src.gitUrl, skill.version, skill.dir)`, returning `{ content, dir: skill.dir }` so the output shape is unchanged for the client.
- **`PublicArchiveNotFoundError`** from either the scan or the read → the existing `NOT_IMPLEMENTED` "preview isn't available for private sources yet". Note the scan now throws it first for a private repo, which is the same outcome the read used to produce.

Update the service's dep interface ([`skills-service.ts:87`](../../../packages/api-server/src/modules/skills/services/skills-service.ts:87)): `readPublicSkill` is replaced by `readPublicSkillFile: (gitUrl: string, version: string, dir: string) => Promise<string | null>`, with a comment saying it reads one pinned file. Rewire the binding in [`compose.ts:88`](../../../packages/api-server/src/modules/skills/compose.ts:88) and its import.

**Do not add a cache here.** The scan cache already carries `{version, dir}`, and the preview query is cached client-side by TanStack Query ([`skill-render-modal.tsx:29`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-render-modal.tsx:29)). Reasoned in the README.

### 3. Correct the subsystem prose and bump `Last verified:`

[`docs/architecture/skills.md:128`](../../architecture/skills.md) says:

> **SKILL.md content read** (`getSkillContent`) — serves one skill's raw `SKILL.md` (frontmatter + markdown body) for the in-product preview, reading through the same public-archive path via `readPublicSkill`. Public sources only; private sources return `NOT_IMPLEMENTED` (preview deferred).

The "same public-archive path" clause is now false. Rewrite it to say what actually happens and *why it matters operationally* — that the read resolves the skill's directory and commit from the cached scan and then fetches that one file pinned at that commit, so a preview costs no repo download and renders the same revision the catalog listed. Keep the public-only / `NOT_IMPLEMENTED` sentence. Name no function signatures (per [guideline line 42](../../guidelines/documentation-guidelines.md:42)).

Check whether the scan-cache paragraph ([`:240`](../../architecture/skills.md)) needs a sentence noting the content read now shares that cache — the coupling is operational (invalidating the cache also affects which revision a preview renders), which is exactly what an architecture page should carry.

Bump `Last verified:` at the top of the page to the date this lands — once, covering both slices' edits.

### 4. Fix and check

```bash
mise run fix && mise run check
```

### 5. No new test, and why

Same reasoning as slice 01, and it applies more strongly here: the behavior worth verifying is "no tarball is fetched", which is a performance property observed against a real repo, not something a unit test over a mocked `fetch` would prove convincingly. Asserting the constructed URL string in a test would restate the implementation. The smoke test below observes the actual absence of the archive fetch.

## Acceptance criteria

- [ ] Opening a preview issues **one** `raw.githubusercontent.com` GET pinned at the skill's `version`, and **no** `archive/HEAD.tar.gz` fetch, whenever the source's scan is cached.
- [ ] `readPublicGithubSkill` and its tarball/extract code are gone; nothing references `readPublicSkill` any more.
- [ ] The pinned reader rejects an escaping `dir` and caps the response size.
- [ ] `getSkillContent`'s output shape is unchanged (`{ content, dir }`), so the modal needs no change in this slice.
- [ ] A private or non-`github.com` source still returns `NOT_IMPLEMENTED`; a name that isn't in the source still returns `NOT_FOUND`.
- [ ] The rendered preview matches the revision the catalog listed — the same SHA the header's GitHub link points at.
- [ ] `docs/architecture/skills.md:128` no longer claims the read goes through the public-archive path, and `Last verified:` is bumped.
- [ ] `mise run check` and `mise run test` pass. No new test files.

## Smoke test

Existing suites first:

```bash
mise run check && mise run test
```

Then observe the fetch behavior directly. Same prerequisites as slice 01 — cluster up, a public GitHub source with skills under a non-top-level root.

1. `mise run cluster:build-apiserver` to load the new read path, then `mise run ui:run` and open **http://localhost:5173** (the cluster serves **http** on 4444; https 404s at Traefik).
2. Open a sandbox → **Skills**, expand the source so its skills list — this warms the scan cache, which is also what happens in the real flow.
3. `mise run cluster:logs -f` in another terminal. Click a skill name and watch: you should see a scan-cache **hit** and **no** archive fetch. Compare against `main`, where every open re-downloads the tarball.
4. In devtools, note the `getSkillContent` request duration. On a large source repo it should drop from seconds to the cost of one small file GET.
5. Close and reopen the same skill, then open a different skill from the same source. Both are immediate, and neither triggers an archive fetch.
6. Correctness, not just speed: confirm the rendered body matches the file the header's GitHub link opens — same content, same commit.
7. Error paths, both of which must behave as they do on `main`: a non-`github.com` source still shows "An in-product preview isn't available for this skill yet" with a working GitHub link; and a source whose scan is cold (restart the api-server pod, then click a skill without expanding the source first) still renders — one scan, then the pinned read.

The implementing agent runs this itself, then prints a short manual guide so the owner can repeat steps 3–7 by hand.
