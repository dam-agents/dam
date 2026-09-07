# 01 — The source link in the contract

**Part of:** file to artifact — see [README](./README.md)

## Context

Nothing records which workspace file an artifact came from. This slice adds that one fact and
threads it through the existing procedures, so slice 02 can pass it from the panel and slice 03
can render it. No new procedure and no new read — `LibraryArtifact` already flows to every
consumer that needs the field.

Apply the `/typescript-engineering` skill.

## Implementation plan

1. **Column.** `sourcePath: text("source_path")` (nullable) on `libraryArtifacts` in
   `packages/db/src/schema.ts`. Generate the migration with `mise run db:generate`; expect a
   single `ALTER TABLE ... ADD COLUMN`.
2. **Contract.** In `packages/api-server-api/src/modules/artifact-library/`:
   - `types.ts`: `sourcePath: string | null` on `LibraryArtifact`; optional `sourcePath` on
     `ArtifactCreateInput` and `ArtifactUpdateInput`.
   - `schemas.ts`: the matching optional Zod field on `artifactCreateInputSchema` and
     `artifactUpdateInputSchema` — a trimmed non-empty string with a sane max (files paths are
     workspace-relative; 1024 is plenty).
3. **Server.** In `packages/api-server/src/modules/artifact-library/`:
   - repository: `source_path` in `artifactColumns`, `insertArtifact` values, and the
     `ArtifactPatch` type so `updateArtifact`/`advanceVersion` can set it.
   - service: `create` stores it; `update` sets it when the input carries it (and leaves it
     alone otherwise — sync passes it, a metadata edit does not).
   - `toView`/mapping: expose `sourcePath` on the returned `LibraryArtifact`.
4. **MCP tools.** In `mcp-tools.ts`, optional `source_path` input on `create_artifact` and
   `update_artifact`, described as the workspace path the content came from, passed through as
   `sourcePath`. Per the README's decided semantics it is a label: the server never reads the
   path.
5. Run `mise run api-server:fix` and the checks below.

## Acceptance criteria

- [ ] `mise run --force db:check`, `--force api-server:check`, `--force api-server:test`,
      `--force api-server-api:check` and `--force common:check:comment-types` pass.
- [ ] The generated migration is exactly one `ADD COLUMN`.
- [ ] `artifactLibrary.create` with `sourcePath` stores it and returns it on the view;
      without the field, existing behaviour is unchanged and the column is null.
- [ ] `artifactLibrary.update` with `sourcePath` sets it; an update without the field leaves a
      stored value untouched.
- [ ] `create_artifact` with `source_path` produces an artifact whose row carries it.

## Smoke test

```sh
mise run --force api-server:check && mise run --force api-server:test
```

Then against a cluster (`mise run cluster:build-apiserver`, migration applies at boot): create
an artifact through the UI's upload dialog (no source), and one via the agent asking it to pass
`source_path`; check `library_artifacts.source_path` in Postgres is null for the first and the
path for the second.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
