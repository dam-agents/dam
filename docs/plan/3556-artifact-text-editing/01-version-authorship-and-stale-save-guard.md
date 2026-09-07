# 01 — Version authorship and the stale-save guard

**Part of:** A user can change the text of an artifact they own — see [README](./README.md)

## Context

Before the UI can offer an edit, the write path needs two things it does not have.
A caller has no way to say which version it edited, so a save from a stale editor
silently replaces a newer agent version at the head. And a version row does not
record who wrote it, so once owners start writing versions the history cannot tell
an owner's edit from an agent's publish. This slice closes both in the contract,
the schema and the service. No UI changes here.

Apply the [`/typescript-engineering`](../../../.claude/skills/typescript-engineering/SKILL.md)
skill.

## Implementation plan

### 1. Schema and migration

In [`packages/db/src/schema.ts`](../../../packages/db/src/schema.ts), add a
nullable `author` column to `libraryArtifactVersions` (the table is at
`schema.ts:637`):

```ts
author: text("author"),
```

Nullable is deliberate: every version row that exists today predates this feature
and its author is genuinely unknown. Do not backfill a guess. No index — the
column is only ever read alongside a version row the primary key already found.

Generate the migration with `mise run db:generate` and commit the generated SQL
under `packages/db/drizzle/`. Do not hand-write it. `mise run db:check:generated`
verifies the migration matches the schema.

### 2. Contract

In [`packages/api-server-api/src/modules/artifact-library/types.ts`](../../../packages/api-server-api/src/modules/artifact-library/types.ts):

- Add `export type ArtifactVersionAuthor = "user" | "agent";`
- Add `author: ArtifactVersionAuthor | null` to `ArtifactVersionInfo`.
- Add `expectedVersion?: number` to `ArtifactUpdateInput`.
- Widen `ArtifactLibraryService.update` to
  `update(id: string, input: ArtifactUpdateInput, attribution?: { agentId: string }): Promise<LibraryArtifact>`,
  matching how `create` already carries attribution.

In [`schemas.ts`](../../../packages/api-server-api/src/modules/artifact-library/schemas.ts):

- Add `artifactVersionAuthorSchema = z.enum(["user", "agent"])`.
- Add `expectedVersion: z.number().int().positive().optional()` to
  `artifactUpdateInputSchema`.

Export the new type and schema from
[`packages/api-server-api/src/index.ts`](../../../packages/api-server-api/src/index.ts)
alongside the artifact-library exports already there (types near line 215,
schemas near line 228).

### 3. Repository

In [`artifact-library-repository.ts`](../../../packages/api-server/src/modules/artifact-library/infrastructure/artifact-library-repository.ts):

- Add `author: string | null` to `VersionRow`. `listVersions` and `getVersion` use
  `select()` over the whole table, so they pick the column up with no query change.
- `insertArtifact` writes the first version row (`repository.ts:187`). Give it the
  author for v1 so a history is coherent from its first entry. Take it from the
  row the caller passes rather than inventing a rule in the repository — add
  `author` to the `insertArtifact` argument and pass it into the version insert.
- `advanceVersion` (`repository.ts:376`) writes the new version row. Add an
  `author` parameter and include it in the insert. Keep the existing
  `expectedVersion` argument — it is the optimistic-lock predicate on the artifact
  row and does a different job from the caller's claim.

### 4. Service

In [`artifact-library-service.ts`](../../../packages/api-server/src/modules/artifact-library/services/artifact-library-service.ts):

- `update` (`service.ts:352`) gains the `attribution` parameter. Derive the author
  from it: attribution present means `agent`, absent means `user`. The MCP tools
  are the only caller that passes it, so an interactive save is a user save by
  construction rather than by a flag the client could get wrong.
- Check the claim **before** ingesting bytes, right after `requireArtifact`:

  ```ts
  if (input.expectedVersion != null && input.expectedVersion !== row.version) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This artifact has a newer version. Reload before saving.",
    });
  }
  ```

  Before, not after, so a refused save never uploads a blob it then has to clean
  up. The existing post-`advanceVersion` conflict branch stays: it catches the
  narrow race between the read and the write, and it already deletes the orphaned
  blob. Two different windows, both needed.
- Pass the author into `advanceVersion` and into `insertArtifact` (in `create`,
  derived from the `attribution` it already receives).
- `listVersions` (`service.ts:283`) maps rows to `ArtifactVersionInfo`. Add
  `author: v.author as ArtifactVersionAuthor | null`.

### 5. Callers

- [`router.ts`](../../../packages/api-server-api/src/modules/artifact-library/router.ts):
  the `update` mutation forwards `input` minus `id` and passes no attribution, so
  it already means "the owner did this". Verify it still type-checks with the
  widened signature; no logic change expected.
- [`mcp-tools.ts`](../../../packages/api-server/src/modules/artifact-library/mcp-tools.ts):
  `update_artifact` (line 273) must pass attribution so an agent publish is
  recorded as `agent`. Use `deps.agentId` — the mesh-verified identity the module
  already passes to `create` at line 150 — and never accept an agent id from tool
  arguments. Do **not** expose `expected_version` as a tool argument: agent
  publishes stay append-only and unrefused.

### 6. Documentation

Update [`docs/architecture/artifact-library.md`](../../architecture/artifact-library.md)
in the "Overview" area where version history and concurrent publishes are already
described. Two facts to add, in domain vocabulary and without field names:

- A version records whether the owner or an agent wrote it, and versions written
  before the platform tracked this say neither.
- An interactive edit states the version it changed and is refused when the head
  has moved on, so an owner never silently replaces a newer agent revision. An
  agent publish is always appended.

Bump `Last verified:` to the day you edit it. The page has room — it is well under
the 40 000 character cap.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass. Existing tests in
      [`artifact-library.test.ts`](../../../packages/api-server/src/__tests__/unit/artifact-library.test.ts)
      build fake repositories; fix their shape where a signature changed rather
      than adding new cases.
- [ ] `mise run db:check:generated` passes — the committed migration matches the schema.
- [ ] An update carrying an `expectedVersion` equal to the head publishes a new version.
- [ ] An update carrying a stale `expectedVersion` fails with `CONFLICT` and leaves
      the head, the version count and the object store untouched.
- [ ] An update carrying no `expectedVersion` behaves exactly as before.
- [ ] A version published through the MCP tool records the agent as author; one
      published through the tRPC mutation records the user.
- [ ] Version rows that existed before the migration list a null author.
- [ ] The architecture page states both new facts and carries today's date.

## Smoke test

Run the existing suites, then exercise the contract by hand against the dev
cluster. Get a token without a browser using the headless password grant, then
call the mutation directly:

```bash
mise run test ::: mise run check
```

Against a running dev cluster (see the [`cluster-ops`](../../../.claude/skills/cluster-ops/SKILL.md)
skill for `cluster:install` and `cluster:status`), pick a text artifact you own
and, from the app at `http://localhost:4444`, use the browser devtools console or
the CLI to call `artifactLibrary.update` three times: once with the correct
`expectedVersion` (expect a version bump), once replaying the same now-stale
number (expect `CONFLICT`), and once with no `expectedVersion` (expect a bump).
Then call `artifactLibrary.listVersions` and confirm the authors read `agent` for
what the agent published and `user` for what you just wrote.

The implementing agent runs this itself, then prints a short manual smoke-test
guide so the user can confirm it by hand.
