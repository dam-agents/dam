# 02 — Preview a private GitHub source's skill

**Part of:** Preview a skill's SKILL.md in-product — see [README](./README.md)

## Context

`getSkillContent` refuses a private source three ways
([`skills-service.ts:402-466`](../../../packages/api-server/src/modules/skills/services/skills-service.ts)):
the host isn't GitHub (gate 1), the cached scan carries no `dir` (gate 2), or the public archive
404s on a cold cache (gate 3). Gates 2 and 3 are the same missing capability wearing two hats —
there is no way to read one file out of a repo the api-server can't see anonymously. A private
repo's archive 404s, the scan falls through to the pod, and the pod's scan doesn't report a
directory, so even a warm cache can't build a raw-file URL.

This slice builds the pod-side read and deletes both gates. Gate 1 stays: the read uses the
GitHub Contents API, and a non-GitHub host would need another `git clone` per preview — the cost
#2826 just removed. See [README § Scope](./README.md#scope).

The pattern to copy is #3139's `readPullRequest`: the api-server asks the agent's own pod to call
GitHub, and the pod's paired gateway injects the owner's token on the wire, so agent-runtime never
holds a credential. Read [`skills.md`](../../architecture/skills.md) § agent-runtime skills
service and § Credential injection on the wire first.

Apply the `/typescript-engineering` skill. Four packages, in dependency order:
`agent-runtime-api` → `agent-runtime` → `api-server-api` → `api-server`.

## Implementation plan

### 1. `agent-runtime-api` — report `dir`, declare the new read

[`types.ts:27`](../../../packages/agent-runtime-api/src/modules/skills/types.ts) — add
`dir: string` to `ScannedSkill`, with a comment that it is the repo-relative directory the skill
was found in (whichever Source Root), which is what a pinned single-file read needs. Required, not
optional: both pod scan paths always know it. The api-server's own `skillSchema` keeps `dir`
optional — that boundary is where an older pod's omission is absorbed, and it already is.

[`schemas.ts`](../../../packages/agent-runtime-api/src/modules/skills/schemas.ts) — add beside
`skillReadPullRequestInputSchema`:

```ts
export const skillReadSkillFileInputSchema = z.object({
  source: z.string().min(1),
  /** Commit SHA the scan pinned — the preview renders the revision the catalog listed. */
  version: z.string().min(1),
  /** Repo-relative skill directory from the scan; `SKILL.md` is read inside it. */
  dir: z.string().min(1),
});
```

Export `SkillReadSkillFileInput` from `types.ts` and add the method to the `SkillsService`
interface there (near `scan`, around line 138), returning
`Promise<Result<{ content: string }, SkillsDomainError>>`. An object, not a bare string, so the
response can grow (e.g. a resolved SHA) without a breaking change.

[`router.ts`](../../../packages/agent-runtime-api/src/modules/skills/router.ts) — add next to
`readPullRequest` (line 113), keeping its `// A query, not a mutation: it reads.` convention:

```ts
readSkillFile: protectedProcedure
  .input(skillReadSkillFileInputSchema)
  .query(async ({ ctx, input }) => {
    const result = await ctx.skills.readSkillFile(input);
    if (!result.ok) throw toTrpcError(result.error);
    return result.value;
  }),
```

### 2. `agent-runtime` — fill `dir` in, and read the file

**Scan reports `dir`** — [`scan.ts`](../../../packages/agent-runtime/src/modules/skills/services/scan.ts).
Both paths already have the repo-relative directory in hand as `rel` and discard it. Add `dir: rel`
to the object literal in `collectSkills` (line 149) and in `scanGitClone` (line 124). Nothing else
changes: `dedupeByName` passes entries through, and the api-server's client casts the array
straight to `Skill[]`.

**A Contents-API file read** —
[`github-rest-client.ts`](../../../packages/agent-runtime/src/modules/skills/infrastructure/github-rest-client.ts).
Add to the `GitHubRestClient` interface and its implementation:

```ts
getFileContent: (
  host: DetectedOwnerRepo,
  ref: string,
  filePath: string,
) => Promise<Result<string, SkillsDomainError>>;
```

Implement with the existing `ghJson` helper against
`${repoPath(host)}/contents/${filePath}?ref=${encodeURIComponent(ref)}`, following
`getPullRequest`'s precedent of being **authenticated by default** — that is the whole point,
since the gateway injects the owner's token for `api.github.com` and the api-server's anonymous
read could only 404. Notes:

- Encode each `filePath` **segment** and rejoin with `/`. `encodeURIComponent` on the whole path
  would escape the separators and break the request target — `repoPath` encodes owner and repo
  individually for the same reason.
- The response is `{ content: string; encoding: "base64" }`. Decode with
  `Buffer.from(content, "base64").toString("utf8")`. Guard the decoded size at 1 MB — the same
  bound `MAX_SKILL_MD_BYTES` puts on the api-server's public read
  ([`public-archive-scanner.ts:38`](../../../packages/api-server/src/modules/skills/infrastructure/public-archive-scanner.ts));
  a `SKILL.md` is kilobytes. Return the pod's `SkillsDomainError` shape on a breach, not a throw.
- If the JSON comes back without `content` (a directory, or a submodule), that's a
  `SourceFetchFailed`-style error, not an empty preview.

**Service method** —
[`skills-service.ts`](../../../packages/agent-runtime/src/modules/skills/services/skills-service.ts).
Add `readSkillFile` to `createSkillsService`'s returned object. Unlike `readPullRequest` it can't
be a one-line delegation, because it must resolve the host and validate `dir`:

- `detectGithubOwnerRepo(input.source)` → on `null`, return an error; the api-server never routes
  a non-GitHub source here (gate 1 catches it first), so this is defense in depth.
- Reject a `dir` that escapes the repo tree. `subPathEscapes` at
  [`local-skill-repository.ts:516`](../../../packages/agent-runtime/src/modules/skills/infrastructure/local-skill-repository.ts)
  is the pod's single copy of that check — **export it** and reuse it rather than writing a third
  one (api-server has its own at `public-archive-scanner.ts:126`, whose `readPublicGithubSkillFile`
  applies the identical guard to the identical value).
- Then `deps.github.getFileContent(host, input.version, \`${input.dir}/SKILL.md\`)`, wrapped to
  `{ content }`.

### 3. `api-server-api` — thread `agentId` through

[`types.ts:59`](../../../packages/api-server-api/src/modules/skills/types.ts) — widen the service
signature to `getSkillContent: (sourceId: string, name: string, agentId?: string) => Promise<{ content: string; dir?: string }>`.

[`router.ts:89-97`](../../../packages/api-server-api/src/modules/skills/router.ts) — pass
`input.agentId` through. The input schema already carries an optional `agentId`, documented as
targeting the pod for private sources, so no schema change. **Replace the stale comment** above
the call — "agentId only scopes the auth check — reading public content needs no pod (private
preview is deferred)" is exactly what this slice falsifies. State the new rule: public content
needs no pod; a private source's read is issued from the pod and therefore needs `agentId`.

`skillContentSchema`'s `dir` stays optional — a legacy pod that predates step 2 reports none.

### 4. `api-server` — dispatch the read, delete the gates

**Client** — [`agent-runtime-client.ts`](../../../packages/api-server/src/modules/skills/infrastructure/agent-runtime-client.ts).
Add `readSkillFile` to the `AgentRuntimeSkillsClient` interface (near `scan`, line 45) and its
implementation beside `readPullRequest` (line 230), wrapped in `runWithUpstreamMapping` like every
sibling so upstream GitHub failures keep arriving as `AgentRuntimeUpstreamError`.

No new infrastructure file. [`pod-pr-state-reader.ts`](../../../packages/api-server/src/modules/skills/infrastructure/pod-pr-state-reader.ts)
exists as its own module only because it is background work carrying a never-wake gate; this read
is a foreground call that wakes, so it belongs inline in the service exactly as `list`'s pod
fallback does.

**Extract the scan dispatch.** `list` (line 348) tries the public archive under
`{ kind: "shared" }`, then falls back to the pod under `{ kind: "owner", owner: deps.owner }` on
`PublicArchiveNotFoundError`, requiring an `agentId` and calling `ensureAgentReachable` first.
`getSkillContent` currently duplicates a *worse* version of that: it only ever calls
`deps.scanPublic`, which is the root cause of gate 2. Pull the dispatch out into a module-private
helper and call it from both:

```ts
type SourceScan = { skills: Skill[]; scannedAt: number; viaPod: boolean };
async function scanForSource(deps, src, agentId?: string): Promise<SourceScan>
```

Move `list`'s body into it verbatim — the `PublicArchiveNotFoundError` fallthrough comment, the
`PRECONDITION_FAILED` "select an instance to scan it" message, the `ensureAgentReachable` call,
the `privateScanErrorToTrpc` mapping, **and both `ScanScope` arguments**. `list` becomes
`resolveSource` + `scanForSource`, discarding `viaPod`.

⚠️ **Two merged PRs shape this function; write against `main` at `a11d7fc2`, and read it before
editing.**

- [#3178](https://github.com/dam-agents/dam/pull/3178) widened `deps.scanSource` to return
  `{ skills, scannedAt }` (epoch ms) and `skills.list` to `{ skills, scannedAt }` (ISO). Hence the
  return type above: the helper carries the pair so `list` keeps serializing its timestamp, while
  `getSkillContent` takes `.skills` and drops `scannedAt`.
- [#3198](https://github.com/dam-agents/dam/pull/3198) added `ScanScope` as `scanSource`'s
  **first** argument and made it part of the cache key. **Carry both scopes across the move
  exactly as they are.** A helper that takes one scope for both branches, or defaults it, would
  serve one user's private skill list to another — undoing a security fix while appearing to be a
  pure refactor. The scopes are not interchangeable: `shared` for the public archive,
  `{ kind: "owner", owner: deps.owner }` for the pod.

`viaPod` is the new part: `false` on the public-archive branch, `true` on the pod branch. It is
trustworthy *because* of #3198 — a `shared` lookup can never be answered by an `owner`-scoped
entry, so the branch that returned the list is also the access level that produced it. Step 4's
file read dispatches on it.

**Rewrite `getSkillContent(sourceId, name, agentId?)`:**

1. `resolveSource` → `NOT_FOUND` on miss (unchanged).
2. Gate 1 survives: `if (!detectHost(src.gitUrl))` → `NOT_IMPLEMENTED`. Reword to name the
   reason — the host, not privacy. The single `deferred` constant ("in-product preview isn't
   available for private sources yet") stops being one message: it now covers three unrelated
   outcomes, so split it and let each say what it means.
3. `const { skills, viaPod } = await scanForSource(deps, src, agentId)`, then find by `name` →
   `NOT_FOUND` with the existing message. Note the wake happens **inside** the helper on the pod
   branch, so `getSkillContent` doesn't call `ensureAgentReachable` itself.
4. Dispatch the file read on `viaPod`. Each branch needs its own `!skill.dir` handling, and they
   mean different things:

   **`viaPod === false`** (public archive, `shared` scope) — `dir` is always set by the
   public-archive scan, so a missing one means an `owner`-scoped entry answered a `shared`
   lookup. [#3198](https://github.com/dam-agents/dam/pull/3198) made that branch a security
   signal: it emits `securityLog("warn", "skill.preview.unscoped_scan", { category: "privileged", … })`
   before throwing. **Keep it exactly as it stands** — log call, event name, and neutral wording.
   It is the anomaly detector for a scoping violation, and this slice must not trade it for a
   friendlier message. Then `deps.readPublicSkillFile(src.gitUrl, skill.version, skill.dir)` →
   `{ content, dir: skill.dir }`, unchanged.

   **`viaPod === true`** (pod scan, `owner` scope) — the source is private. Here `!skill.dir` means
   the sandbox's runtime predates step 2, which is a stale deployment, **not** a scoping violation:
   plain `NOT_IMPLEMENTED` saying the runtime is too old to locate the skill's directory, and **no**
   security log. Otherwise
   `deps.runtimeClient.readSkillFile(agentId, { source: src.gitUrl, version: skill.version, dir: skill.dir })`,
   wrapped in the same `privateScanErrorToTrpc(err) ?? err` mapping the pod scan uses, so a missing
   GitHub grant renders the `access_restricted` CTA rather than a raw 404. `agentId` is
   non-null here — reaching this branch required it (the helper already threw
   `PRECONDITION_FAILED` otherwise) — but narrow it for the type checker rather than asserting.

Note what leaves: the outer `catch (err) { if (err instanceof PublicArchiveNotFoundError) … }` that
turned a cold-cache 404 into a deferral. That 404 now surfaces inside `scanForSource` and drives
the pod fallback, which **is** gate 3's removal. Don't keep a second copy of the escalation here.

**Do not security-log a successful private read.** The closest precedent governs: scanning a
private source already reads that repo through the owner's injected token on every `list`, and is
unlogged. A single-file read of a repo the user can already enumerate is the same class of access,
not a new privilege. (`skills.md` records the parallel reasoning for why the `readLocal`
passthrough is deliberately unlogged.)

**Compose** — [`compose.ts:76-79`](../../../packages/api-server/src/modules/skills/compose.ts)
needs no change; `scanSource` is `sharedScanCache.scan`, and `runtimeClient` and
`readPublicSkillFile` are already wired.

### 4b. The modal must actually render a `NOT_IMPLEMENTED` message

Found while smoke-testing slice 01, and pre-existing on `main` (verified by reverting
`skill-render-modal.tsx` and reproducing): a `getSkillContent` that answers `501` leaves the
modal on the loading skeleton **forever**. The api-server returns one well-formed tRPC error,
no retries follow, and `isPending` never flips to `isError`, so the fallback paragraph never
renders.

This slice owns the fix, because gate 1 survives it: a non-GitHub source still returns
`NOT_IMPLEMENTED`, and the acceptance criterion below requires a message *naming the host* —
which is unverifiable while the message can't reach the screen. Diagnose the stuck pending
state first (start at the `useQuery` in
[`skill-render-modal.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-render-modal.tsx),
the `retry: 3` default in [`query-client.ts`](../../../packages/ui/src/query-client.ts), and the
custom `fetch` in [`api.ts`](../../../packages/ui/src/api.ts) that reacts only to 502/503), then
fix it there rather than papering over it in the shell.

Also update the now-false comment above that `dir` fallback — "there the scan comes from
agent-runtime, which doesn't report `dir`" — which step 2 falsifies.

### 5. Architecture doc — [`docs/architecture/skills.md`](../../architecture/skills.md)

- **§ api-server skills service**, the `getSkillContent` bullet (line 130): drop "Public sources
  only; private sources return `NOT_IMPLEMENTED` (preview deferred)". Describe both paths —
  anonymous read first, escalating to the publishing agent's pod on a 404 — and **state the waking
  decision explicitly**, contrasting it with the badge's never-wakes rule: a preview is
  user-initiated, so spending the user's compute on it is what they asked for. Note the surviving
  limit: non-GitHub hosts.
- **§ agent-runtime skills service** (line 143): add `readSkillFile` to the listed tRPC surface,
  and a responsibility bullet for it — reads one `SKILL.md` at a pinned commit through the
  Contents API, authenticated by default so the gateway's injection is on the hot path, with no
  repo download. Note under **Scan** that it now reports `dir`.
- **§ Skill, Installed Skill Ref, Local Skill** (line 79): the Scanned Skill definition already
  describes `dir` generically; confirm it doesn't imply only the api-server's scan reports it, and
  fix it if it does.
- **§ Skill Origin** (line 103), where the badge's never-wakes rule lives: one clause noting the
  preview path deliberately differs, so a reader doesn't take "never wakes" as subsystem-wide.
- **§ api-server skills service**, the **scan cache** bullet (line 128): #3198 rewrote this to
  describe credential scoping. Don't restate or re-explain it — the preview shares that cache, so
  the only thing to add is that a private preview reads through the owner-scoped entry, if the
  `getSkillContent` bullet doesn't already make that plain.
- Bump `Last verified:` (line 3) — already `2026-08-06` from today's merges, so bump only if the
  implementation date differs.

Follow [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md).
Don't link or reference ADRs.

### 6. Finish

`mise run check`, then `mise run test`.

## Tests

**No new tests by default.** The existing suite plus the manual pass below covers this.
`skills-scan-errors.test.ts` already pins the upstream-error mapping this path reuses, and
[#3198](https://github.com/dam-agents/dam/pull/3198) left `skills-scan-scope.test.ts` +
`skills-scan-cache.test.ts` guarding the cache keying this slice refactors — which is the safety
net that matters most here. Run them and leave them alone.

**One narrow exception, with a trigger:** if the private fixture in the smoke test can't be
arranged (no private repo, or no GitHub credential connectable on the dev cluster), the private
branch would ship unverified. In that case — and only then — add one focused unit test on the
`getSkillContent` dispatch: a stubbed `readPublicSkillFile` throwing `PublicArchiveNotFoundError`
must escalate to `runtimeClient.readSkillFile` with the scan's `{version, dir}`, and a public read
that succeeds must never touch the pod. Follow `skills-scan-errors.test.ts`'s style. Say in the
commit body that it stands in for the manual check.

## Acceptance criteria

- [ ] A skill in a **private** GitHub source renders its `SKILL.md` in the modal instead of the
      "isn't available" fallback.
- [ ] A **public** source's preview is unchanged and still issues **no** pod call (verify the
      sandbox stays asleep when previewing a public skill).
- [ ] The pod's scan reports `dir`, and the api-server's `list` output carries it through for a
      private source.
- [ ] A **non-GitHub** source still returns `NOT_IMPLEMENTED`, with a message naming the host
      rather than claiming private previews are deferred.
- [ ] A private preview with **no** connected GitHub credential surfaces the
      `access_restricted` / `app_not_connected` CTA, not a bare 404.
- ~~Previewing a private source's skill on a **hibernated** sandbox wakes it and renders.~~
      **Dropped — unreachable in the UI, verified on the dev cluster.** The Skills surface is
      `pointer-events-none` whenever the agent isn't operable, so no name is clickable while
      hibernated; and opening the panel already wakes the sandbox, because the eager per-source
      scan needs the pod for a private source. The wake itself is implemented and still matters
      for non-UI callers — it comes from `ensureAgentReachable` inside the shared scan dispatch —
      so `skills.md` states it as a property of the read rather than a click path.
- [ ] `getSkillContent` and `list` share one scan dispatch — `getSkillContent` no longer calls
      `scanPublic` directly.
- [ ] Both `ScanScope` arguments survived the extraction: the public branch still scans as
      `{ kind: "shared" }` and the pod branch as `{ kind: "owner", owner: deps.owner }`. The
      existing `skills-scan-scope.test.ts` and `skills-scan-cache.test.ts` still pass **unmodified**
      — if either needed editing to go green, the refactor changed scoping behavior.
- [ ] The `skill.preview.unscoped_scan` security log still fires on a `dir`-less **shared** scan,
      with its event name and wording intact. The private path's stale-runtime case does **not**
      emit it.
- [ ] `skills.md` documents `readSkillFile`, the removed deferral, and the waking decision; the
      `Last verified:` date is bumped.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

```bash
mise run check && mise run test
```

Then manually. **Arrange the fixture first — it is the long pole:** a private GitHub repo holding
at least one skill under `skills/` (or `.claude/skills/`), a GitHub credential connected on the
sandbox, and a running sandbox. Use the `cluster-ops` skill. Rebuild both sides — this slice
changes agent-runtime *and* api-server:

```bash
mise run cluster:build-agent && mise run cluster:build-apiserver
```

Build the agent **first**: `cluster:build-agent` can leave a pre-branch api-server pod running,
which makes the agent-side `dir` look like it never shipped.

At **`http://localhost:4444`** (https 404s at Traefik):

1. Add the private repo as a skill source on a running sandbox. Its skills list (this is the pod
   scan path).
2. Click a skill's name → the modal renders its `SKILL.md`.
3. Click a skill in a **public** source → still renders, and the sandbox is not woken.
4. Disconnect the GitHub credential and retry the private one → the connection CTA, not a raw
   error. Reconnecting needs an OAuth sign-in, so budget for that before disconnecting.

If a response is missing `dir`, suspect a stale api-server before suspecting the code — zod
`.output()` strips fields an older api-server doesn't send.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
