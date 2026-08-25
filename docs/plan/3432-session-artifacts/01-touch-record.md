# 01 — Touch record, its two doors, and the tool marker

**Part of:** session artifacts on the Home feed cards — see [README](./README.md)

## Context

Nothing today links an artifact to a session. This slice creates the record that will hold that
link, the two procedures that write and read it, and the marker on the artifact tools that makes
their results recognisable to the runtime. It ships without a producer — slice 02 supplies that —
so it is verified by calling the procedures directly.

Apply the `/typescript-engineering` skill.

## Implementation plan

### 1. The table

Add a table to `packages/db/src/schema.ts` recording one row per touch: the agent, the session, the
artifact, the artifact version, and when it happened. Key it so the same version cannot be recorded
twice, and index it for the read in step 4 — the query is "touches for these sessions of this
agent, newest first".

Reference `libraryArtifacts` with `onDelete: "cascade"` so deleting an artifact takes its touches
with it. Do the same for the agent if an agent-scoped foreign key exists; if it does not, note that
touches are cleaned up with the artifact only, and that agent deletion leaves them — the pattern
schedules already suffer from, worth not repeating silently.

Generate the migration with `mise run db:generate`. Do not hand-write it.

### 2. The marker on the artifact tools

In `packages/api-server/src/modules/artifact-library/mcp-tools.ts`, the `json()` helper at line 25
already serialises tool results, and `create_artifact` already returns the artifact id in its
payload. Add a stable, versioned marker field to the payloads of **`create_artifact`** (line 80)
and **`update_artifact`** (line 260) — those two are the touches. Leave the other ten tools alone:
reading, sharing, folder operations and deletion are not touches.

Define the marker's shape and its Zod schema in a module both sides can import, since slice 02
parses exactly this. Keep the version field in it — an adapter or payload change should be
detectable rather than silently misread.

### 3. The pod-facing ingest

Add a procedure the agent-runtime calls to report a touch. It belongs on the harness surface, which
the pod already reaches — `packages/api-server-api/src/modules/runtime/harness-router.ts`, mounted
by `packages/api-server/src/apps/harness-api-server/runtime-trpc.ts`, whose context carries the
verified `agentId`.

Take the agent from that context and never from the payload, so a pod can only ever record touches
for itself. The session id is a label: the platform has no session list to validate it against
([ADR-055](../../adrs/055-agent-owned-session-metadata.md)), and scoping the write to the
authenticated agent is what makes that safe. Verify the artifact belongs to that agent before
recording, so a pod cannot attach a touch to another agent's artifact.

Make the write idempotent — slice 02 may report the same touch twice after a reconnect.

### 4. The owner-facing read

Add an owner-scoped read to the schedules-style contract in
`packages/api-server-api/src/modules/artifact-library/`: given an agent and a set of session ids,
return the touches. Cap the input, and clamp the limit **in the repository that issues the query**,
as `approvals-repository.ts` does.

Enforce the caller's agent binding **inside the query**, not by filtering the returned rows. The
same shape as `schedules-repository.ts`'s `listForOwner`, which takes the binding as a query
conjunct so a limit cannot hide the caller's own rows behind rows it may not see.

### 5. Checks

`mise run api-server:check`, `api-server:test`, `api-server-api:check`, `db:check` if the task
exists, and `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] `mise run --force api-server:check`, `--force api-server:test`,
      `--force api-server-api:check` and `--force common:check:comment-types` pass.
- [ ] The migration is generated, and `mise run db:migrate` applies cleanly against a fresh database.
- [ ] `create_artifact` and `update_artifact` results carry the versioned marker; the other artifact
      tools are unchanged.
- [ ] The ingest takes its agent from the verified context, refuses an artifact belonging to another
      agent, and recording the same touch twice leaves one row.
- [ ] The read returns nothing for an agent the caller is not bound to, and its limit is clamped in
      the repository.
- [ ] Deleting an artifact deletes its touches.

## Smoke test

```sh
mise run --force api-server:check
mise run --force api-server:test
```

Then against a cluster:

1. `mise run cluster:build-apiserver` and wait for the pod.
2. Publish an artifact through the UI or the CLI so a row exists in `library_artifacts`.
3. Call the ingest procedure as an agent, naming that artifact and any session id string, and
   confirm one touch row appears in Postgres.
4. Call it again with the same values and confirm there is still one row.
5. Call the owner read for that agent and session and confirm the touch comes back; call it for an
   agent the key is not bound to and confirm it comes back empty.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
