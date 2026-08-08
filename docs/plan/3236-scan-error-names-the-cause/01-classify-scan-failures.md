# 01 — Server: classify every scan failure

**Part of:** Skill source scan errors name their cause — see [README](./README.md)

## Context

Today a failed scan can reach the UI as a raw message: `privateScanErrorToTrpc` returns `null`
for anything outside the two error classes it knows, and `scanForSource` rethrows that untouched.
This slice makes `scanForSource` the one place a scan failure is judged: every throw leaving it
carries a structured `ScanFailure`, including a generic backstop for shapes nobody anticipated.
It also adds the design's new named cause — "this sandbox has no GitHub connection" — which
needs a signal the upstream error cannot give us, because the gateway no longer emits
`app_not_connected`.

Apply the [`/typescript-engineering`](../../../.claude/skills/typescript-engineering/SKILL.md)
skill. Read [`docs/architecture/skills.md`](../../architecture/skills.md) § *api-server skills
service* and § *Listing & scan* first.

## Implementation plan

1. **Declare the contract.** In
   [`packages/api-server-api/src/modules/skills/schemas.ts`](../../../packages/api-server-api/src/modules/skills/schemas.ts)
   add `scanFailureCodes`, `scanFailureSchema`, and the `ScanFailure` type exactly as pinned in
   the [README](./README.md#the-contract-both-slices-implement-against-this). This file is
   browser-safe — no Node imports — because the UI imports from it in slice 02. Re-export the
   type from `packages/api-server-api/src/modules/skills/types.ts` alongside the existing skills
   types.

2. **Lift the cause onto the wire.** In
   [`packages/api-server-api/src/trpc.ts`](../../../packages/api-server-api/src/trpc.ts), pass an
   `errorFormatter` to `initTRPC.context<ApiContext>().create({ … })` that reads
   `error.cause.scanFailure`, validates it with `scanFailureSchema.safeParse`, and merges it into
   `shape.data` as `scanFailure`. Mirror the shape of
   [`packages/agent-runtime-api/src/trpc.ts`](../../../packages/agent-runtime-api/src/trpc.ts),
   which does the same for `data.upstream`. Leave the `t` spread and the telemetry-wrapped
   `procedure` below it untouched — the formatter belongs on the `create()` call, not on the
   wrapper.

3. **Write the copy table.** New file
   `packages/api-server/src/modules/skills/domain/scan-failure.ts`:
   - The four `{ code, title, detail }` records from the README table, as one frozen map.
   - `scanFailureError(code): TRPCError` — builds the `TRPCError` with the tRPC code from the
     README table, `message` set to `` `${title} ${detail}` `` (the CLI reads `.message`), and
     `cause: { scanFailure }`.
   - `hasScanFailure(err): boolean` — whether a throwable already carries one, so the catch-all
     in step 6 does not re-wrap an already-classified error.
   This is domain: pure data and construction, no I/O.

4. **Add the connections port.** New file
   `packages/api-server/src/modules/skills/infrastructure/github-credential-port.ts` exporting
   `createGithubCredentialPort(db: Db)` with one method:

   ```ts
   /** Whether this sandbox's granted connections inject a credential for
    *  api.github.com — the only thing that lets a private-source scan authenticate. */
   hasGithubApiCredential(agentId: string): Promise<boolean>;
   ```

   Implement it over `createConnectionsRepository(db).listConnectionsForAgent(agentId)`
   ([`connections-repository.ts:172`](../../../packages/api-server/src/modules/connections/infrastructure/connections-repository.ts)),
   returning true when any returned connection has a contribution with
   `kind === "egress-inject"` and `host === "api.github.com"`. Check the host, not the template
   id: the `github`, `github-pat`, and GitHub App templates all contribute that host, and a
   GitHub Enterprise connection contributes a different one — which is correct, since a
   `github.com` skill source cannot be read with it. Skill sources reaching this path are
   `github.com` URLs by construction (`detectHost` gates the fast path above it).

   The skills module already imports directly from `../agents/` and `../templates/`; this follows
   that pattern. Keep the port's surface to this one boolean — the skills module has no business
   knowing what a Connection is.

5. **Compose it.** In
   [`compose.ts`](../../../packages/api-server/src/modules/skills/compose.ts), build the port
   from the `db` argument `composeSkillsModule` already receives and pass it into
   `createSkillsService`. Add the field to `SkillsServiceDeps` in `skills-service.ts`. **No
   call-site changes** are needed in
   [`apps/api-server/app.ts`](../../../packages/api-server/src/apps/api-server/app.ts) or
   [`apps/harness-api-server/app.ts`](../../../packages/api-server/src/apps/harness-api-server/app.ts) —
   both already hand `db` to `composeSkillsModule`.

6. **Classify in `scanForSource`.** In
   [`skills-service.ts`](../../../packages/api-server/src/modules/skills/services/skills-service.ts)
   (the helper at ~line 275, shared by `list` and `getSkillContent`):
   - Wrap the whole body in one `try`/`catch`.
   - In the catch: rethrow unchanged anything for which `hasScanFailure` is true; otherwise log
     the original error at `error` level with the source URL and agent id, and throw
     `scanFailureError("other")`. This is the backstop — after it, no unclassified message can
     leave this helper.
   - Replace the `ensureAgentReachable` call's escaping errors with `agent_unreachable`: catch
     around it and rethrow `scanFailureError("agent_unreachable")`, logging the original. Today
     those surface raw text like `agent could not be made ready: <k8s message>`.
   - Keep the existing `PRECONDITION_FAILED` "source is private; select an instance to scan it"
     throw, but give it `scanFailureError("other")`'s treatment with its own title/detail — it is
     the one deliberate precondition here and should not read as a generic failure. (It is
     unreachable from the sandbox Skills surface, where `agentId` is always present.)

7. **Split the access family.** In
   [`upstream-to-trpc.ts`](../../../packages/api-server/src/modules/skills/infrastructure/upstream-to-trpc.ts):
   - `privateScanErrorToTrpc` keeps its shape but returns the new errors:
     `AgentRuntimeUnreachableError` → `agent_unreachable`; the 404 / 401 /
     `upstream_unreachable` family → `repo_unreachable`; other upstream statuses continue through
     `upstreamToTrpc` (unchanged — publish shares it).
   - It cannot decide `needs_github_connection` on its own: that needs the port. Give it an extra
     parameter or have `scanForSource` post-process — either is fine, but the call must be made
     **only** on the `repo_unreachable` branch, so the extra DB read happens on failure and never
     on the happy path. When `hasGithubApiCredential(agentId)` is false, the failure becomes
     `needs_github_connection` instead.
   - Delete `SCAN_ACCESS_MESSAGE`; its words move into the `repo_unreachable` row of the copy
     table. Check for other importers before deleting.

8. **Update the existing test.**
   [`packages/api-server/src/__tests__/unit/skills-scan-errors.test.ts`](../../../packages/api-server/src/__tests__/unit/skills-scan-errors.test.ts)
   asserts `SCAN_ACCESS_MESSAGE` and asserts `toBeNull()` for an unrecognized error — both change
   here. Rewrite those assertions against the new codes, and change the "unknown error" case from
   "returns null" to "classifies as `other`", which is the invariant this slice exists to
   establish. **Update in place — do not add a new test file.**

9. **Update the architecture page.** [`docs/architecture/skills.md`](../../architecture/skills.md)
   § *Listing & scan* gains a short paragraph: every scan failure is classified into a named
   `ScanFailure` carried on `data.scanFailure`, unclassified shapes become a generic failure, and
   the "needs a GitHub connection" verdict is read from the sandbox's granted connections rather
   than inferred from the upstream status. Bump `Last verified:` to the day you make the change.

## Acceptance criteria

- [ ] `scanFailureSchema` and `ScanFailure` are exported from `api-server-api` and the schemas
      file imports nothing Node-only.
- [ ] A tRPC error thrown with `cause: { scanFailure }` arrives at the client with
      `data.scanFailure` populated; one thrown without a cause is unchanged.
- [ ] Scanning a private source from a sandbox with no GitHub connection yields
      `code: "needs_github_connection"` with the design's exact title and detail.
- [ ] Scanning an unreachable repo from a sandbox that *does* have a GitHub connection yields
      `code: "repo_unreachable"`.
- [ ] `hasGithubApiCredential` is called only on the failure path — a successful scan performs no
      extra connections read.
- [ ] No throw leaves `scanForSource` without a `scanFailure` cause; the original error text is
      logged server-side, not sent.
- [ ] `.message` on every one of these errors is a readable sentence, so the CLI's
      `skill` commands still print something sensible.
- [ ] `skills-scan-errors.test.ts` is updated in place; no new test file exists.
- [ ] `docs/architecture/skills.md` reflects the new behavior with a current `Last verified:`.

## Smoke test

```bash
mise run check && mise run test
```

Then against the dev cluster, with `mise run cluster:build-apiserver` applied — mint a token per
the CLI-smoke recipe (Keycloak password grant, `dev`/`dev`, client `platform-ui`, against
`http://keycloak.localhost:4444`), then, for a sandbox with **no** connections and a private
GitHub source:

```bash
curl -s -X POST "http://localhost:4444/api/trpc/skills.sources.refresh" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"id":"<sourceId>"}'
```

followed by a `skills.listWithScan` query for that `sourceId` + `agentId`. The response must be
HTTP 412 with `data.scanFailure.code === "needs_github_connection"` and the design's title and
detail. Grant that sandbox a GitHub connection, refresh again, and the same call must return
either the skills list or `repo_unreachable` — never `needs_github_connection`. The
`sources.refresh` call is mandatory between attempts: the scan cache is owner-scoped with a
5-minute TTL and will otherwise serve the previous verdict.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
