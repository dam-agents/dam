# 01 — Scope cached scans by the credentials that produced them

**Part of:** Scope the skill scan cache — see [README](./README.md)

## Context

The scan cache serves one entry per repository + subdirectory to every caller, regardless of
whether the entry came from an uncredentialed archive read or from a scan that ran with a
particular owner's credentials. This slice records that distinction on each entry and enforces
it on lookup. It is the whole feature.

## Implementation plan

Apply the `/typescript-engineering` skill throughout.

1. **Introduce the scope type** in
   [`packages/api-server/src/modules/skills/infrastructure/scan-cache.ts`](../../../packages/api-server/src/modules/skills/infrastructure/scan-cache.ts):

   ```ts
   export type ScanScope = { kind: "shared" } | { kind: "owner"; owner: string };
   ```

   Export it — the service passes it in. Give it a doc comment saying what each variant means in
   terms of the scan that produced the entry, not in terms of repository visibility: a public
   repository scanned through the credentialed path is still `owner`-scoped.

2. **Carry the scope on the entry.** Add `scope: ScanScope` to the module-private `CacheEntry`,
   alongside the existing `skills` / `expiresAt` / `scannedAt`.

3. **Take the scope on the read.** Change `ScanCache["scan"]` to accept the scope as its first
   parameter — `scan(scope, gitUrl, path, scanner)` — and store it on the entry written after a
   miss. Update the interface's doc comment: a hit now requires both freshness *and* a matching
   scope.

4. **Match on lookup.** A stored entry satisfies a lookup only when its scope equals the
   caller's — `shared` matches `shared`; `owner` matches only the same `owner` string. Implement
   this as a small module-private predicate rather than inline boolean soup. Deliberately use
   exact match, not "a shared entry may also serve an owner lookup": the shared lookup always
   runs first in the service, so the permissive case would be unreachable, and exact match is
   the easier invariant to hold.

   A non-matching entry is a **miss**, not an error — control flow past the lookup is unchanged,
   and the fresh scan overwrites the slot.

5. **Leave `invalidate` alone.** It still deletes the single key regardless of scope. This is
   why the key isn't being widened; confirm no call site needs to change.

6. **Extend the log lines** so the scope is visible: include it in the `cache hit` / `cache miss`
   / `cache invalidated` lines. The smoke test below reads these, and they are the only
   observability the cache has.

7. **Wire the three call sites** in
   [`packages/api-server/src/modules/skills/services/skills-service.ts`](../../../packages/api-server/src/modules/skills/services/skills-service.ts).
   Update the `scanSource` signature on `SkillsServiceDeps` (~line 75) to take the scope, then:

   - `list`, public-archive branch (~line 359) → `{ kind: "shared" }`
   - `list`, agent-runtime branch (~line 385) → `{ kind: "owner", owner: deps.owner }`
   - `getSkillContent`, public-archive read (~line 419) → `{ kind: "shared" }`

   `deps.owner` is already in scope in all of them — the service is composed per request around
   one owner. Refresh the `scanSource` doc comment, which currently describes the cache as shared
   across users without qualification.

8. **Verify the fall-through still reads correctly.** In `list`, a credentialed source now misses
   the shared lookup, runs the archive probe, takes its 404, and falls through to the
   agent-runtime branch as before — where it hits its own owner-scoped entry. Nothing in the
   error handling changes; confirm by reading, not by adding guards.

9. **Correct the `!skill.dir` guard in `getSkillContent`** (~line 435). Its comment says a
   `dir`-less skill means the cached scan came from agent-runtime — that is, it documents the
   uncredentialed lookup reading a credentialed entry. Scan scoping ends that, so the branch
   becomes unreachable: the public-archive scan always sets `dir`, and only a public-archive scan
   can now reach this point.

   The guard itself must stay — `readPublicSkillFile` takes `dir` as a required string while
   `skill.dir` is optional, so the check is what gives the read below it a correct type. Rewrite
   the comment to state that invariant, and add a `securityLog` warning on the branch: if it ever
   runs, an owner-scoped entry answered a shared lookup, and that must be visible rather than
   degrade quietly into the existing `NOT_IMPLEMENTED`. `securityLog` is already imported and used
   twice in this file — match those call shapes. User-visible behaviour does not change.

10. **Keep the existing cache tests compiling.** The cases in
    [`packages/api-server/src/__tests__/unit/skills-scan-cache.test.ts`](../../../packages/api-server/src/__tests__/unit/skills-scan-cache.test.ts)
    call `scan` and need the new scope parameter. Update the call sites only — do not add cases;
    the scoping is verified by the smoke test below.

11. **Update the architecture page.** In
    [`docs/architecture/skills.md`](../../architecture/skills.md), the scan-cache bullet under
    "api-server skills service" describes the cache as keyed per repository. Say that an entry
    also records whether the scan it came from depended on a user's credentials, and is reused
    only by requests with equivalent access. Keep it semantic — no type names, no field names,
    per the documentation guidelines. Watch the page's character cap (`mise run check` enforces
    it); this should be a rewritten sentence, not an added paragraph.

## Acceptance criteria

- [ ] A cache entry produced by the credentialed scan path is not served to a different owner.
- [ ] A cache entry produced by the credentialed scan path is not served to the uncredentialed
      lookup that runs first in `list`.
- [ ] The same owner listing the same credentialed source twice within the cache window still
      gets a cache hit on the credentialed lookup.
- [ ] Uncredentialed public-archive scans are still shared across all users — no per-owner
      re-scan of public sources.
- [ ] `sources.refresh` and the post-publish invalidation still clear the entry, unchanged.
- [ ] The `getSkillContent` guard reports rather than absorbs an unscoped read, and its comment
      no longer describes the old cross-scope behaviour.
- [ ] `mise run check` and `mise run test` pass.
- [ ] The skills architecture page describes the scoping accurately and stays within its size cap.

## Smoke test

Run the existing suite and the gate:

```
mise run api-server:test
mise run check
```

Then confirm the scoping by hand against the dev cluster. One account is enough — the property is
visible in the api-server's own log lines, which step 6 puts the scope into. Deploy first with
`mise run cluster:build-apiserver`, then read the lines with
`kubectl logs deploy/platform-apiserver | grep '\[skills\]'`.

1. Open the skills surface for a sandbox with a **public** GitHub source. Reload it.
   Expect a miss then a hit, both at `shared` scope — uncredentialed scans are still shared.
2. Open the skills surface for a sandbox with a **credentialed** source. Reload it.
   Expect a `shared` miss on every view (the archive probe), and an `owner` hit on the second.

Step 2 is the whole fix: before this change, the second view hits on the *shared* lookup, because
the credentialed entry answers an uncredentialed request. After it, the shared lookup never hits
and only the owner lookup does. No second account is needed to see the difference.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
