# 01 — Interactive artifacts exist and cannot be shared

**Part of:** Interactive Artifacts — see [README](./README.md)

## Context

An artifact gains one new property: whether it may ask its agent. It is settled when the
artifact is created and no revision can move it, for the same reason its kind cannot move — a
share link vetted once must not later serve something that behaves differently. This slice adds
that property, surfaces it, and makes sharing an interactive artifact impossible. No callback
machinery yet.

## Implementation plan

Apply the `/typescript-engineering` skill (server) and `/react-ui-engineering` skill (UI).

1. **Schema.** Add `interactive: boolean("interactive").notNull().default(false)` to
   `libraryArtifacts` in [`packages/db/src/schema.ts`](../../../packages/db/src/schema.ts).
   Run `mise run db:generate` and add the top comment explaining why. Never hand-edit the
   generated SQL, journal, or snapshot.
2. **Contract.** In
   [`packages/api-server-api/src/modules/artifact-library/schemas.ts`](../../../packages/api-server-api/src/modules/artifact-library/schemas.ts)
   add `interactive: z.boolean().optional()` to the create input and `interactive: z.boolean()`
   to the artifact read type in `types.ts`. Do **not** add it to any update or revision input:
   its absence there is the immutability.
3. **Repository.** Carry the column through
   [`artifact-library-repository.ts`](../../../packages/api-server/src/modules/artifact-library/infrastructure/artifact-library-repository.ts):
   insert on create, select on every read projection.
4. **Service.** In
   [`artifact-library-service.ts`](../../../packages/api-server/src/modules/artifact-library/services/artifact-library-service.ts):
   - `create` accepts `interactive` and stores it. Reject `interactive: true` for any kind that
     cannot execute (only HTML qualifies for now) with a `BAD_REQUEST` naming the kind.
   - `setSharing` refuses when the artifact is interactive: `TRPCError` with code
     `PRECONDITION_FAILED` and a message a person can read, e.g. "this page can talk to your
     agent, so it cannot be shared". Place the check before any mutation.
5. **MCP tool.** Extend the publish tool in
   [`mcp-tools.ts`](../../../packages/api-server/src/modules/artifact-library/mcp-tools.ts)
   with an `interactive` argument, described plainly: it makes the page able to call back, and
   it makes the artifact unshareable. Mention that it cannot be changed later.
6. **UI.** In [`packages/ui/src/modules/artifacts/`](../../../packages/ui/src/modules/artifacts/):
   - `share-dialog.tsx` — when the artifact is interactive, do not offer the toggle; show the
     reason instead.
   - `artifact-badges.tsx` — a badge marking an interactive artifact, so the library shows
     which pages are live.

## Acceptance criteria

- [ ] `mise run db:check:generated` passes and the migration is committed with its journal entry.
- [ ] Creating an artifact with `interactive: true` stores it; the value appears on reads.
- [ ] No code path can set `interactive` on an existing artifact, including publishing a new
      version.
- [ ] `setSharing` on an interactive artifact fails with `PRECONDITION_FAILED` and the artifact
      stays private.
- [ ] `interactive: true` on a non-HTML kind is rejected at create.
- [ ] The share dialog explains the refusal instead of offering a toggle that fails.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run check && mise run test`, then against a running dev cluster
(`mise run cluster:status` to confirm it is up): publish an interactive artifact through the
agent's MCP tool, open the Artifacts destination, confirm the badge shows and the share dialog
refuses with a reason. Then confirm a normal artifact still shares as before.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
