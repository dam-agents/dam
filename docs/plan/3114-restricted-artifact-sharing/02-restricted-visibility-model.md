# 02 — Restricted visibility: model, service, contract, agent refusal

**Part of:** Share an artifact with a restricted group — see [README](./README.md)

## Context

Everything server-side that does not touch the share host: the third visibility value, the
viewer table, the service that maintains the list, the tRPC contract the UI (slice 05) and the
gate (slice 04) both build on, the share event on leaving private, and the rule that agents
cannot touch a restricted artifact's sharing. The contract is pinned here so 04 and 05 can be
implemented against it independently.

## Implementation plan

Apply `/typescript-engineering`. Read `docs/architecture/persistence.md` for the migration
convention.

**Contract (`packages/api-server-api/src/modules/artifact-library/`)**

1. `schemas.ts`: `artifactVisibilitySchema = z.enum(["private", "restricted", "public"])`.
   Add `viewerEmailSchema = z.string().trim().toLowerCase().email().max(254)` and extend
   `artifactSharingInputSchema` with `viewers: z.array(viewerEmailSchema).max(50).optional()`.
   `viewers` is the full replacement list. Do not add `viewers` to the create/publish schema:
   an artifact is created `private` or `public` and restricted afterwards from the dialog.
2. `types.ts`: `ArtifactVisibility` gains `"restricted"`; `LibraryArtifact` gains
   `viewers: string[]` (always present, empty unless restricted was ever set);
   `ArtifactSharingInput` gains `viewers?: string[]`.
3. `router.ts`: no new procedure. `setSharing` stays on `manageAgentsProcedure` and carries
   the widened input. Mark in a short doc comment on the schema that `viewers` replaces the
   list wholesale.

**Storage (`packages/db/`)**

4. `src/schema.ts`: add `libraryArtifactViewers = pgTable("library_artifact_viewers", …)` with
   `artifactId text references libraryArtifacts.id onDelete cascade`, `email text notNull`,
   `addedAt timestamptz notNull default now()`, primary key `(artifactId, email)`. No change to
   `libraryArtifacts.visibility` (it is `text`); the enum lives in Zod.
5. `mise run db:generate` to emit `0039_*.sql`. Commit the SQL and the `meta` snapshot.

**Repository (`packages/api-server/src/modules/artifact-library/infrastructure/artifact-library-repository.ts`)**

6. Add `listViewers(artifactId): Promise<string[]>` and
   `replaceViewers(artifactId, emails: string[]): Promise<void>` (delete + insert in one
   transaction, `db.transaction`). Add `listViewersForMany(ids)` if `listArtifacts` would
   otherwise N+1 when mapping rows to `LibraryArtifact` (it will: do it as one `inArray`
   query grouped in memory).
7. `listSharedInFolder` / `countSharedInFolder` keep filtering `visibility = "public"`.
   Decision 4: restricted artifacts never appear on folder pages.

**Service (`packages/api-server/src/modules/artifact-library/services/artifact-library-service.ts`)**

8. `toLibraryArtifact(row, shareBaseUrl, viewers)`: `shareUrl` is non-null for both `public`
   and `restricted`; pass `viewers` through. Update every call site (`list`, `get`, `create`,
   `update`, `setSharing`, …) to supply the list (from the batched lookup in 6).
9. `setSharing`:
   - If `before.visibility === "restricted"` and the composed `surface` is the agent MCP
     surface (see how `surface` is threaded into this service from `mcp-tools.ts` /
     `compose.ts`), throw `TRPCError({ code: "FORBIDDEN", message: "Restricted by the owner.
     Change sharing in the app." })` before any write. This also covers `expiresInHours`
     changes: keep it simple, the whole call is refused.
   - If the surface is an agent surface and `input.visibility === "restricted"` or
     `input.viewers` is present, refuse with the same code (belt and braces; the tool schema
     will not offer them).
   - When `input.viewers !== undefined`, call `repo.replaceViewers` in the same flow as the
     visibility patch. Normalisation already happened in Zod.
   - Emit `ArtifactShared` when `before.visibility === "private" && updated.visibility !==
     "private"`. Keep the event payload; `visibility` already travels in it.
10. `create` with `visibility: "public"` is unchanged. Reject `visibility: "restricted"` on
    create at the schema level (step 1 already does, since create keeps its own schema; verify).

**MCP tools (`packages/api-server/src/modules/artifact-library/mcp-tools.ts`)**

11. Keep `z.enum(["private", "public"])` on both tools. Extend the two descriptions with one
    sentence: "Restricted sharing (a named list of viewers) is set by the owner in the app;
    this tool cannot set it or change an artifact that is already restricted."
12. Make sure a `FORBIDDEN` from the service surfaces as a tool error text, not a thrown 500,
    through the existing `run()` wrapper. If `run()` already maps `TRPCError` codes, nothing to
    do.

**Usage saga**

13. `packages/api-server/src/modules/usage/sagas/persist-activity.ts` already persists
    `artifact_shared` with the event's `visibility`. Confirm no `=== "public"` filter exists
    there; if it does, widen it.

14. `mise run api-server:check:events` (event payload lint), `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] `mise run db:generate` produced one migration adding `library_artifact_viewers` with the
      cascade and composite key; `mise run db:migrate` applies it on a fresh dev DB.
- [ ] `setSharing({ visibility: "restricted", viewers: [" Ana@Corp.com "] })` from the UI
      surface stores `ana@corp.com`, returns `visibility: "restricted"`, a non-null
      `shareUrl`, and `viewers: ["ana@corp.com"]`.
- [ ] `setSharing({ visibility: "public" })` from the agent surface on a restricted artifact
      throws `FORBIDDEN` and changes nothing.
- [ ] `ArtifactShared` is emitted on `private → restricted` and `private → public`, not on
      `restricted → public`.
- [ ] `list` for an owner with 100 artifacts issues one viewers query, not one per row.
- [ ] `mise run api-server:check`, `mise run api-server:test`, `mise run api-server-api:check`,
      `mise run db:check` pass. The existing share-viewer unit tests still pass unchanged
      (`resolveArtifact` is not touched in this slice).

## Smoke test

```
mise run db:generate && git status --short packages/db
mise run api-server:check && mise run api-server:test && mise run api-server-api:check
```

Manual, against the dev cluster after `mise run cluster:build-apiserver`: from the browser
devtools on the Artifacts page, call the `artifactLibrary.setSharing` mutation through the
existing tRPC client with `{ id, visibility: "restricted", viewers: ["a@b.co"] }` and read back
`artifactLibrary.list`; the row shows `visibility: "restricted"`, `viewers: ["a@b.co"]`, and a
`shareUrl`. Then, from an agent chat, ask it to make that artifact public; the tool reply
contains "Restricted by the owner".
