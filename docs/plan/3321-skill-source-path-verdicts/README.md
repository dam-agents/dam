# Skill source path failures become named verdicts

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3321

## Goal

A skill source can carry an optional repo-relative **path**. When that path resolves to nothing, the source lists no skills and says **"No skills in this source."** — the same sentence a genuinely empty repo produces. Nothing tells the user the path is the problem. This cost real debugging time on a live install, where two sources had the path field filled in as though it were a label.

After this feature, a scan of a source with an explicit path that yields nothing fails with a named verdict that says which of two things happened:

- the path is not a directory in the repo at that revision;
- the path is a directory, but holds no skill.

Both name the path and, where known, the resolved commit. The verdict reaches the UI, which is where the mistake is made.

**Explicitly not wanted** (from the issue): no fallback to the default source roots when an explicit path yields nothing. An explicit path is honoured exactly as given. A wrong one is a user error to report, never to paper over.

## Approach

See [`docs/architecture/skills.md`](../../architecture/skills.md) — sections *Skill Source*, *Source Roots*, and *Listing & scan*.

The subsystem already has the mechanism this needs. Every scan failure leaves the dispatch as a **`ScanFailure` verdict** — `{ code, title, detail }` from a closed set, carried on the tRPC error's `cause` and lifted onto `data.scanFailure` by the api-server's error formatter. The UI renders any verdict through `SourceError`, and the CLI reads the flattened sentence off `message`. So the feature is: add two codes to that closed set, and make both scanners report into them instead of returning an empty array.

### Path outcome vocabulary

A scan of a source **with an explicit path** resolves to exactly one of three outcomes. Both scanners use these words:

| Outcome | Meaning | Verdict |
|---|---|---|
| `found` | the path is a directory and holds at least one child with a `SKILL.md` | — (skills returned) |
| `path-missing` | the path is not a directory in the repo at that revision | `source_path_not_found` |
| `path-empty` | the path is a directory, but no child of it holds a `SKILL.md` | `source_path_empty` |

A source with **no** path is untouched: the source-roots union, then the top-level fallback, and an empty result stays a legitimate empty result. Only an explicit path can fail this way — that is what makes the failure attributable.

### Why two scanners

The identical swallow-the-error code exists twice:

- [`public-archive-scanner.ts`](../../../packages/api-server/src/modules/skills/infrastructure/public-archive-scanner.ts) — `findSkillDirs` / `skillDirsUnder`, the api-server's public GitHub path.
- [`local-skill-repository.ts`](../../../packages/agent-runtime/src/modules/skills/infrastructure/local-skill-repository.ts) — `findSkillDirsInClone` / `skillDirsUnder`, the pod's path for private and non-GitHub sources.

Fixing only the first leaves every private source silent. The architecture requires the two scanners to agree on resolution, so both slices are needed. Slice 01 closes the issue's own repro (a public repo); slice 02 makes the private path say the same thing.

### Where classification happens

`scanForSource` in [`skills-service.ts`](../../../packages/api-server/src/modules/skills/services/skills-service.ts) is the **single** classification site for both slices. It already wraps `runScanForSource` and owns the catch-all that turns an unrecognised error into the generic verdict. It also has `src` in scope, so it knows the configured path without either scanner echoing it back over the wire.

Slice 01 adds the public-scanner branch to that catch. Slice 02 adds the pod branch beside it. The two branches build the same verdict through one copy builder, so the sentence a user reads never depends on which scanner answered.

### Nesting

Discovery is one level deep below the path — a path pointing at a directory that nests skills deeper is `path-empty`. This is stated in the `source_path_empty` copy ("skills are found one level below the path") rather than fixed by a deeper probe. Changing discovery depth would change resolution semantics for every source, which this issue does not ask for.

### Accepted consequences

- **A failing scan is not cached.** The scan cache stores results, not errors, so a source with a bad path re-downloads the archive on each list until the path is fixed. This matches every other scan failure already (`repo_unreachable`, `agent_unreachable`), but it *is* a change for this case, which used to cache an empty list for the 5-minute TTL. Negative caching would mean teaching the shared cache to hold verdicts — a change to shared infrastructure affecting all failure kinds, and out of scope here.
- **Pod skew.** Slice 02's behavior appears only once the agent image carries the new agent-runtime. An agent running an older image keeps returning a silent empty list. See [Smoke test](#whole-feature-smoke-test).

### Pinned decisions

- **Verdict codes:** `source_path_not_found`, `source_path_empty`, appended to `scanFailureCodes` in [`packages/api-server-api/src/modules/skills/schemas.ts`](../../../packages/api-server-api/src/modules/skills/schemas.ts) before `other` (which stays last).
- **tRPC status:** both map to `BAD_REQUEST` in `TRPC_CODE`. The fault is the source's stored configuration, not a missing server resource. `NOT_FOUND` would read as "the repository was not found", which `repo_unreachable` already owns.
- **Copy is built once**, by a `sourcePathFailure(reason, { path, version })` helper in [`domain/scan-failure.ts`](../../../packages/api-server/src/modules/skills/domain/scan-failure.ts), beside the existing `scanFailure`. Default `COPY` entries stay path-less, so a verdict is still readable if context is missing.
- **The CTA says delete and re-add.** Path is one per `(owner, gitUrl)` and changing it is delete + re-add — the architecture's rule, not a UI limitation. Copy must not tell the user to edit the path.
- **`version` is optional in the copy.** The public archive and the pod's tarball branch both know the commit before resolving the path. The pod's `git clone` branch resolves a commit per skill, so it has none to report on a failure — the sentence drops the commit clause there rather than inventing one.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | [Named path verdicts on the public archive scan](./01-public-archive-path-verdicts.md) | The two verdict codes and their copy; the public scanner reports `path-missing` / `path-empty`; `scanForSource` classifies; a helper line on the Path field | — |
| 02 | [The pod scan reports the same verdicts](./02-pod-scan-path-verdicts.md) | Domain error kinds, the runtime's structured error transport, `findSkillDirsInClone` outcome, api-server client + classification | 01 |

## Conventions & glossary

- **Source path** — the optional repo-relative subdirectory on a skill source. When set, it is scanned exclusively, bypassing the source-roots union and the top-level fallback.
- **Source roots** — `skills`, `.claude/skills`, `.agents/skills`, in that order, from `agent-runtime-api`. Used only when no path is set.
- **Verdict** — a `ScanFailure` of `{ code, title, detail }` from the closed set. Structural, so a client can tell a conclusion the server reached from a transport failure that never got there.
- Apply the `/typescript-engineering` skill to every server-side change in both slices, and `/react-ui-engineering` to the one UI file in slice 01.
- No code comments (see [`CLAUDE.md`](../../../CLAUDE.md)). Run `mise run common:check:comment-types` after each slice.
- Documentation changes follow [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md). Each slice updates [`docs/architecture/skills.md`](../../architecture/skills.md) for what it shipped and bumps `Last verified:`.

## Whole-feature smoke test

On the local dev cluster (see the `cluster-ops` skill), with the agent image rebuilt so the pod carries the new runtime:

```bash
mise run cluster:build-agent
```

Then, on a sandbox's Skills page:

1. **Public, missing path** — add source `https://github.com/apocohq/skills` with path `aposkills`. The card shows a red error naming `aposkills` and the commit, not "No skills in this source."
2. **Public, empty path** — add the same repo with the path pointed at one skill's own directory (e.g. `skills/<skill-name>`). The card says the path exists but holds no skill, and mentions that skills are found one level below it.
3. **Public, no path** — add the same repo with the path cleared. The 14 skills list as before.
4. **Private, missing path** — add a private repo the sandbox's GitHub connection can read, with a bogus path. The card shows the same sentence as step 1 — same copy, different scanner.
5. **CLI** — `dam skill list` against the broken source prints the same sentence on one line.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/3321.
