# 02 — The pod scan reports the same verdicts

**Depends on:** 01-public-archive-path-verdicts
**Part of:** Skill source path failures become named verdicts — see [README](./README.md)

## Context

Slice 01 fixed the api-server's public GitHub scan. Every other source — private GitHub, non-GitHub — is scanned by the agent-runtime inside the pod, and that scanner has the same bug in the same shape: `findSkillDirsInClone` calls `skillDirsUnder`, which swallows a failed `readdir` and returns `[]`. So a private source with a wrong path is still silent. This slice makes the pod report which of the two cases it hit, carries that answer structurally to the api-server, and classifies it into the verdicts slice 01 introduced — same copy, same builder, so the sentence never depends on which scanner answered.

Apply the `/typescript-engineering` skill throughout. No UI change in this slice.

## Implementation plan

### 1. Domain error kinds

[`packages/agent-runtime-api/src/modules/skills/types.ts`](../../../packages/agent-runtime-api/src/modules/skills/types.ts)

Add two members to the `SkillsDomainError` union:

```ts
| { kind: "SourcePathNotFound"; source: string; path: string; version?: string }
| { kind: "SourcePathEmpty"; source: string; path: string; version?: string }
```

`version` is optional because the `git clone` scan branch resolves a commit per skill and has none to report on a failure.

### 2. Structured transport, pod → api-server

Two files, and the ordering trap in step 5 is the reason this has to be structural rather than a message.

[`packages/agent-runtime-api/src/modules/skills/router.ts`](../../../packages/agent-runtime-api/src/modules/skills/router.ts) — add both kinds to `toTrpcError`. `code: "BAD_REQUEST"`, a readable message naming the path, and:

```ts
cause: { sourcePath: { reason: "path-missing" | "path-empty", version } }
```

The api-server composes the user-facing copy from **its own** `src.path`, so the wire payload carries only the discriminator and the commit. Do not echo the user's path string back for display. `toTrpcError` is an exhaustive `switch` over the union, so the build fails until both cases exist.

[`packages/agent-runtime-api/src/trpc.ts`](../../../packages/agent-runtime-api/src/trpc.ts) — the `errorFormatter` currently lifts only `cause.upstream` onto `data`. Add a second lift for `cause.sourcePath`, mirroring `extractUpstream`: validate the shape (`reason` is one of the two strings) and spread it onto `data` when present.

### 3. The pod scanner reports the outcome

[`packages/agent-runtime/src/modules/skills/infrastructure/local-skill-repository.ts`](../../../packages/agent-runtime/src/modules/skills/infrastructure/local-skill-repository.ts)

Change `findSkillDirsInClone` to return the outcome instead of a bare `string[]`:

```ts
type CloneScanOutcome =
  | { kind: "found"; dirs: string[] }
  | { kind: "path-missing" }
  | { kind: "path-empty" };
```

Rework only the explicit-`subPath` branch, exactly as slice 01 reworked the public scanner:

- keep the `subPathEscapes` throw as it is;
- `readdir` the joined directory directly. `ENOENT` / `ENOTDIR` → `{ kind: "path-missing" }`. Any other `readdir` error propagates;
- collect children holding a `SKILL.md` under the existing rules (real directories only, dot-prefixed skipped);
- empty collection → `{ kind: "path-empty" }`, otherwise `{ kind: "found", dirs }`.

The default-roots branch always returns `{ kind: "found", dirs }`, empty or not. Update the `LocalSkillRepository` interface declaration (around line 64) to the new return type.

Leave `resolveSkillDirInClone` alone. It is the install-time resolver for one named skill and already returns a typed `SkillNotFoundInSource`.

### 4. The scan service maps outcome to domain error

[`packages/agent-runtime/src/modules/skills/services/scan.ts`](../../../packages/agent-runtime/src/modules/skills/services/scan.ts)

Both call sites of `findSkillDirsInClone` must handle the outcome:

- `collectSkills` (the GitHub tarball branch) — has `version` in scope, so include it.
- `scanGitClone` — omit `version`.

Map `path-missing` → `err({ kind: "SourcePathNotFound", source, path: subPath, version })`, `path-empty` → `err({ kind: "SourcePathEmpty", ... })`. Both functions already return `Result<ScannedSkill[], SkillsDomainError>`, so this is a new early return, not a signature change.

### 5. The api-server client recognises it

[`packages/api-server/src/modules/skills/infrastructure/agent-runtime-client.ts`](../../../packages/api-server/src/modules/skills/infrastructure/agent-runtime-client.ts)

Add an error class beside the existing ones:

```ts
export class AgentRuntimeSourcePathError extends Error {
  constructor(
    label: string,
    readonly reason: "path-missing" | "path-empty",
    readonly version?: string,
  ) { ... }
}
```

In `runWithUpstreamMapping`, check `data.sourcePath` **before** the `PASSTHROUGH_CODES` branch. This is the trap: `PASSTHROUGH_CODES` contains `"BAD_REQUEST"`, and step 2 sends `BAD_REQUEST`, so the existing branch would convert the error into a plain `AgentRuntimeClientError` and the `sourcePath` payload would never be read. Order matters, and nothing else enforces it.

A `BAD_REQUEST` without a `sourcePath` payload must still take the passthrough branch exactly as before.

### 6. Classify at the same dispatch site

[`packages/api-server/src/modules/skills/services/skills-service.ts`](../../../packages/api-server/src/modules/skills/services/skills-service.ts)

Extend the `scanForSource` catch that slice 01 added, so both scanners converge on one builder:

```ts
if (err instanceof AgentRuntimeSourcePathError && src.path) {
  throw scanFailureToTrpc(
    sourcePathFailure(err.reason, { path: src.path, version: err.version }),
  );
}
```

The path comes from `src`, which `scanForSource` already holds. Guard on `src.path` being set — without an explicit path the pod cannot produce this error, and the verdict has nothing to name.

No ordering problem with the existing pod handling: `podGithubVerdict` runs inside `runScanForSource`, `privateScanFailure` returns `null` for anything that is not an `AgentRuntimeUpstreamError` or `AgentRuntimeUnreachableError`, so the error rethrows and reaches `scanForSource` untouched.

### 7. Documentation

[`docs/architecture/skills.md`](../../architecture/skills.md)

- *Listing & scan* — the verdict paragraph now describes both scanners reporting into the same two codes.
- *agent-runtime side*, the **Scan** bullet — an explicit path that resolves to nothing is a named failure, not an empty list.
- Remove the "api-server public scan only" qualifier slice 01 added.
- Bump `Last verified:`.

## Acceptance criteria

- [ ] A source scanned through the pod with a path that is not a directory produces `source_path_not_found`, with the same copy the public scanner produces for the same mistake.
- [ ] A pod-scanned path that is a directory holding no `SKILL.md` child produces `source_path_empty`.
- [ ] The verdict names the commit when the pod scanned a GitHub tarball, and omits the commit clause on the `git clone` branch, without printing an empty or placeholder sha.
- [ ] A source with **no** path is unchanged on the pod path: union, top-level fallback, empty result allowed.
- [ ] A `BAD_REQUEST` from the pod that carries no `sourcePath` payload still becomes an `AgentRuntimeClientError`, as before.
- [ ] Install is untouched: `resolveSkillDirInClone` and `install.ts` behave exactly as before.
- [ ] `mise run check`, `mise run test`, and `mise run common:check:comment-types` pass.
- [ ] `docs/architecture/skills.md` describes both scanners agreeing, with `Last verified:` bumped.

## Smoke test

```bash
mise run check ::: mise run test
```

Then on the dev cluster (`cluster-ops` skill). The pod runs the agent image, so the new runtime is not live until it is rebuilt — without this the scan stays silent and the slice looks broken:

```bash
mise run cluster:build-agent
```

On a sandbox that has a GitHub connection granted:

1. Add a **private** repo source the connection can read, with a bogus path. Expect the same red error as slice 01's step 1, naming the path.
2. Point the path at a directory that exists in that repo but holds no skill. Expect the "holds no skill" verdict.
3. Clear the path (remove and re-add). Expect the skills to list, proving the fallback-free path did not break normal resolution.
4. Confirm the sentence is identical to what a public source with the same mistake shows.

If no private repo is reachable from this cluster, that manual path is unavailable and the pod branch is otherwise unverifiable. Only in that case, add one focused unit test over `findSkillDirsInClone` covering the three outcomes, in `packages/agent-runtime/src/__tests__/unit/`. This is the exception to the no-new-tests default — take it only if step 1 cannot be run, and say so in the report.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
