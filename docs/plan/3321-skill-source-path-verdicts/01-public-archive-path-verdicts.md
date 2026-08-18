# 01 — Named path verdicts on the public archive scan

**Part of:** Skill source path failures become named verdicts — see [README](./README.md)

## Context

The api-server scans public GitHub sources itself, by downloading `archive/HEAD.tar.gz`. When the source carries an explicit path, `findSkillDirs` scans only that path, and `skillDirsUnder` swallows a failed `readdir` and returns `[]`. "The directory is not there" and "the directory is there but holds no skill" collapse into the same empty list, which the UI renders as "No skills in this source." This slice gives those two cases their own verdicts, and adds the helper line the Path form field is missing.

Read the README's *Path outcome vocabulary* and *Pinned decisions* before starting. Apply the `/typescript-engineering` skill to the server-side files and `/react-ui-engineering` to the one UI file.

## Implementation plan

### 1. Contract — two new verdict codes

[`packages/api-server-api/src/modules/skills/schemas.ts`](../../../packages/api-server-api/src/modules/skills/schemas.ts)

Append `"source_path_not_found"` and `"source_path_empty"` to `scanFailureCodes`, before `"other"` (which stays last). `ScanFailureCode` and `scanFailureSchema` derive from that array, so nothing else in the contract package changes, and the UI's `toScanFailure` parses the new codes with no UI change.

### 2. Verdict copy

[`packages/api-server/src/modules/skills/domain/scan-failure.ts`](../../../packages/api-server/src/modules/skills/domain/scan-failure.ts)

Add both codes to the `COPY` record. Keep the defaults path-less — they are the fallback when context is missing:

- `source_path_not_found` — title: `This source's path isn't in the repository`. detail: `The path configured on this source doesn't exist in the repository. Remove the source and add it again with the correct path, or with none.`
- `source_path_empty` — title: `No skills under this source's path`. detail: `The path configured on this source exists but holds no skill. Skills are found one level below the path. Remove the source and add it again with the correct path, or with none.`

Then add, beside the existing `scanFailure`:

```ts
export function sourcePathFailure(
  reason: "path-missing" | "path-empty",
  ctx: { path: string; version?: string },
): ScanFailure
```

It returns `scanFailure(code, { detail })` with a detail that names the path in quotes and appends `at commit <short sha>` when `ctx.version` is present. Keep the delete-and-re-add sentence — path is one per `(owner, gitUrl)` and changing it is delete + re-add, so telling the user to edit it would be wrong. Short the sha to 7 characters.

`scanFailureMessage` already flattens title + detail for the CLI; no change needed there.

### 3. tRPC status mapping

[`packages/api-server/src/modules/skills/infrastructure/upstream-to-trpc.ts`](../../../packages/api-server/src/modules/skills/infrastructure/upstream-to-trpc.ts)

Add both codes to `TRPC_CODE` as `"BAD_REQUEST"`. The record is keyed on `ScanFailureCode`, so TypeScript fails the build until both are present — that is the exhaustiveness guard, and it is why step 1 comes first.

### 4. The scanner reports which case it hit

[`packages/api-server/src/modules/skills/infrastructure/public-archive-scanner.ts`](../../../packages/api-server/src/modules/skills/infrastructure/public-archive-scanner.ts)

Export a single error class carrying both cases, beside `PublicArchiveNotFoundError`:

```ts
export class SkillSourcePathError extends Error {
  constructor(
    readonly reason: "path-missing" | "path-empty",
    readonly path: string,
    readonly version: string,
  ) { ... }
}
```

One class with a `reason` field, not two classes — the verdict builder is keyed on that same reason, and the two are never handled apart.

Change `findSkillDirs(repoDir, subPath)` to take the resolved `version` as well, and rework its explicit-path branch:

- keep the `subPathEscapes` rejection exactly as it is;
- `readdir` the joined directory directly instead of going through `skillDirsUnder`. On `ENOENT` or `ENOTDIR`, throw `SkillSourcePathError("path-missing", subPath, version)`. Let any other `readdir` error propagate — it is a real fault and belongs in the generic verdict, not in a path verdict;
- collect the children that hold a `SKILL.md`, using the same rules as `skillDirsUnder` (real directories only, dot-prefixed skipped);
- if that collection is empty, throw `SkillSourcePathError("path-empty", subPath, version)`.

Leave the default-roots branch and `skillDirsUnder` untouched. Silence is correct there: the union tries three roots and then falls back to top-level, so an individual missing root is not an error.

`scanPublicGithubArchive` already computes `version` from the redirect SHA before it extracts the tarball, so pass it down at the existing `findSkillDirs(repoDir, subPath)` call site.

### 5. Classify at the dispatch

[`packages/api-server/src/modules/skills/services/skills-service.ts`](../../../packages/api-server/src/modules/skills/services/skills-service.ts)

`runScanForSource` catches only `PublicArchiveNotFoundError` in its public branch and rethrows everything else, so a `SkillSourcePathError` reaches `scanForSource` — which currently turns any unrecognised error into the generic `other` verdict. Add the classification to `scanForSource`'s catch, ahead of that catch-all and after the existing `hasScanFailure` passthrough:

```ts
if (err instanceof SkillSourcePathError) {
  throw scanFailureToTrpc(
    sourcePathFailure(err.reason, { path: err.path, version: err.version }),
  );
}
```

Put it here, not in `runScanForSource`: slice 02 adds its pod branch beside this one, and `scanForSource` is where both converge on one copy builder. Import `scanFailureToTrpc` (already imported alongside `scanFailureError`) and `sourcePathFailure`.

Do **not** add a fallback to the default roots. The issue rules it out.

### 6. Helper line on the Path field

[`packages/ui/src/modules/sandboxes/components/skills/github-source-tab.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/github-source-tab.tsx)

The Path field is the only one of the three with no explanation, which is how it gets filled in as though it were a label. Add a `<p className="text-sm text-muted-foreground">` under the input, matching the Skill group name field's helper exactly:

> Repo subdirectory holding the skills — e.g. `skills/`. Leave empty to search the usual locations.

No other UI change. `SourceError` already renders any verdict's title and detail, and `isConnectionFailure` correctly excludes the new codes, so the card gets the new message with no work.

### 7. Documentation

[`docs/architecture/skills.md`](../../architecture/skills.md)

- *Skill Source* (the paragraph on the optional path) — state that an explicit path that resolves to nothing is a named verdict, not an empty list, and that there is no fallback to the source roots.
- *Listing & scan*, the verdict paragraph — name the two new codes and what tells them apart.
- Note that this is the api-server's public scan; the pod path still returns an empty list until slice 02. The page must describe the code as it is at this commit.
- Bump `Last verified:` to the implementation date.

Follow [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md).

## Acceptance criteria

- [ ] `scanFailureCodes` carries `source_path_not_found` and `source_path_empty`, and `TRPC_CODE` maps both — the build fails without it.
- [ ] A public github.com source with a path that is not a directory produces `source_path_not_found`, whose detail names the path and the 7-character commit.
- [ ] A public github.com source with a path that is a directory holding no `SKILL.md` child produces `source_path_empty`, whose detail says skills are found one level below the path.
- [ ] Both verdicts tell the user to remove and re-add the source, never to edit the path.
- [ ] A source with **no** path behaves exactly as before: source-roots union, top-level fallback, and an empty result stays an empty result with no error.
- [ ] An explicit path that fails never falls back to the source roots.
- [ ] A traversal path (`..`, leading `/`) is still rejected before any filesystem read.
- [ ] The Path field in the add-source modal shows the helper line.
- [ ] `mise run check` and `mise run test` pass with no edits to the existing tests in [`public-archive-scanner.test.ts`](../../../packages/api-server/src/__tests__/unit/public-archive-scanner.test.ts) — its subPath and traversal cases must keep passing untouched.
- [ ] `mise run common:check:comment-types` passes.
- [ ] `docs/architecture/skills.md` describes the behavior at this commit, with `Last verified:` bumped.

## Smoke test

Run the existing suites — `public-archive-scanner.test.ts` already covers the explicit-subPath and traversal cases, so a regression there is a real failure, not a stale expectation:

```bash
mise run check ::: mise run test
```

Then, on the dev cluster (`cluster-ops` skill), on a sandbox's Skills page:

1. Add source `https://github.com/apocohq/skills` with path `aposkills`. Expect a red error naming `aposkills` and the commit — this is the issue's own repro.
2. Remove it, and add the same repo with the path pointed at one skill's own directory (`skills/<skill-name>`, taken from the listing in step 3). Expect the "holds no skill" verdict.
3. Remove it, and add the same repo with the path empty. Expect all 14 skills to list.
4. `dam skill list` against the source from step 1 prints the same sentence on one line.

Note: the UI is served at `http://localhost:4444` (http, not https), and a stale service worker can serve an old bundle after a UI build.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
