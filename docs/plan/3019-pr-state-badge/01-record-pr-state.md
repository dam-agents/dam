# 01 — Record the resolved pull-request state

**Part of:** #3019 — see [README](./README.md)

## Context

Nothing today stores what became of a publish's pull request. This slice adds the columns and the
contract field to hold it, and threads them through the repository — but resolves nothing. Every
record reads `prState: null`, so the UI is byte-for-byte unchanged and the branch stays green.
Splitting it out this way means slices 02, 03 and 04 all implement against a contract that is
already pinned.

Apply the `/typescript-engineering` skill.

## Implementation plan

### 1. Schema

[`packages/db/src/schema.ts:297`](../../../packages/db/src/schema.ts:297) — add three nullable
columns to `agentSkillPublishes`:

```ts
prState: text("pr_state"),
prStateCheckedAt: timestamp("pr_state_checked_at", { withTimezone: true }),
prEtag: text("pr_etag"),
```

`text`, not a pg enum — the value set is GitHub's, and a plain column avoids a migration every
time we widen it. Validation belongs at the contract edge (step 2), not in the column type.

All three nullable, with no default: `null` means "never resolved", which is the honest state for
every row that exists today and for every future row the moment it is written.

Add a top-of-migration comment saying *why* (per [`packages/db/CLAUDE.md`](../../../packages/db/CLAUDE.md)),
then:

```bash
mise run db:generate
```

**Never hand-write the `.sql`, `_journal.json`, or snapshot.** Commit all three together.

### 2. Contract

[`packages/api-server-api/src/modules/skills/schemas.ts:82`](../../../packages/api-server-api/src/modules/skills/schemas.ts:82) —
extend `skillPublishRecordSchema`:

```ts
/** Resolved outcome of `prUrl`, or null when it has never been resolved —
 *  no source is public, the read was rate-limited, the pull request is gone.
 *  `merged` and `closed` are terminal and never re-read (#3019). */
prState: z.enum(["draft", "open", "merged", "closed"]).nullable(),
/** ISO 8601; null while `prState` is null. */
prStateCheckedAt: z.string().nullable(),
```

`prEtag` stays **server-side only** — it is transport bookkeeping, not something the UI has any
use for. Do not add it to the schema.

Note the doc comment above this schema still says `instance_skill_publishes` and "Drives the
`Published` badge". Update it to name the real table (`agent_skill_publishes`) and describe the
state-aware badge, since this slice is what makes the old wording wrong.

### 3. Repository

[`agent-skills-repository.ts:115`](../../../packages/api-server/src/modules/skills/infrastructure/agent-skills-repository.ts:115) —
`listPublishes` maps rows explicitly, so add the two fields to the mapping:

```ts
prState: r.prState as SkillPublishRecord["prState"],
prStateCheckedAt: r.prStateCheckedAt?.toISOString() ?? null,
```

The cast is needed because the column is `text`. Keep it local to this mapping — it is the single
place the widened column type narrows to the contract's union, and the Zod schema at the tRPC
edge is what actually enforces it.

`appendPublish` ([line 131](../../../packages/api-server/src/modules/skills/infrastructure/agent-skills-repository.ts:131))
needs no change: omitting the columns inserts `null`, which is correct — a freshly opened pull
request is unresolved until the resolver says otherwise, and guessing `open` here would be a
claim we have not verified.

Add one new method to the port for slice 02 to call:

```ts
/** Persist a resolved state. Terminal states (`merged`, `closed`) are written
 *  once and the record is never read again, so this is the only writer. */
setPrState(
  prUrl: string,
  next: { prState: string; checkedAt: Date; etag: string | null },
): Promise<void>;
```

Key on `prUrl`, not on `(agentId, skillName)` — the same pull request can be referenced by
records for different agents, and resolving it once should settle all of them in one update.

## Acceptance criteria

- [ ] `mise run db:generate` produced a migration, journal entry and snapshot, all committed, with a
      why-comment at the top of the `.sql`.
- [ ] `mise run check` passes, including `db:check:generated`.
- [ ] `skillPublishRecordSchema` carries `prState` and `prStateCheckedAt`, both nullable; `prEtag`
      is **not** in the contract.
- [ ] `listPublishes` returns `prState: null` / `prStateCheckedAt: null` for existing rows.
- [ ] `setPrState` exists on the repository port and its implementation keys on `prUrl`.
- [ ] The stale `instance_skill_publishes` / "Published badge" doc comment above the schema is
      corrected.
- [ ] No UI file is touched; the pill renders exactly as it does on `main`.

## Smoke test

```bash
mise run check && mise run test
```

Then confirm the migration applies and the contract flows through, against the local cluster
(`cluster-ops` skill):

1. `mise run cluster:build-apiserver` — migrations run automatically at api-server startup.
2. Confirm the columns exist:
   ```bash
   mise run cluster:kubectl -- exec -n default platform-postgres-0 -- psql -U platform -d platform -c "\d agent_skill_publishes"
   ```
3. Open a sandbox with an existing publish record → **Skills**. The pill must read exactly as
   before (`Published · {source}`), proving the added fields are inert.

The implementing agent runs this itself, then prints a short manual guide for step 3.
