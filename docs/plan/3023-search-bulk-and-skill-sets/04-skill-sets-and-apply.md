# 04 — Skill sets: table, CRUD, and additive apply

**Depends on:** 02
**Part of:** search, bulk-toggle and skill sets — see [README](./README.md)

## Context

This is the slice that stops the re-picking. A **skill set** is a per-user named list of
`(gitUrl, name)` pairs, saved from one sandbox and added to another. It records which skills, not
which versions — applying it resolves the current version from the source at that moment.

Server side only; 05 and 06 are its two modals.

Apply the `/typescript-engineering` skill.

## Implementation plan

1. **Schema.** In [`packages/db/src/schema.ts`](../../../packages/db/src/schema.ts), beside
   `skillSources` (~line 155):

   ```ts
   export const skillSets = pgTable(
     "skill_sets",
     {
       id: text("id").primaryKey(),
       owner: text("owner").notNull(),
       name: text("name").notNull(),
       // [{ source: <gitUrl>, name }] — the install key, not a source id: a set
       // must survive its source row being deleted and re-added.
       skills: jsonb("skills").notNull(),
       createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
     },
     (table) => [
       uniqueIndex("skill_sets_owner_name_idx").on(table.owner, table.name),
       index("skill_sets_owner_idx").on(table.owner),
     ],
   );
   ```

   Entries as jsonb on one row, not a child table: nothing queries by entry, and one row makes create
   and delete atomic. A plain unique index on `(owner, name)` is enough for the case-insensitive
   uniqueness the prototype validates, because the name schema already forces lowercase.

   Generate the migration with `mise run db:generate` and commit the `.sql`, the journal entry and the
   snapshot with the schema change.

2. **Contract.** In
   [`packages/api-server-api/src/modules/skills/schemas.ts`](../../../packages/api-server-api/src/modules/skills/schemas.ts):

   - `skillSetEntrySchema` — `{ source: z.string().url(), name: z.string().min(1) }`.
   - `skillSetSchema` — `{ id, name, skills: array(entry), createdAt }`.
   - `skillSetNameSchema` — **reuse `connectionNameSchema`** from
     [`connections/schemas.ts`](../../../packages/api-server-api/src/modules/connections/schemas.ts)
     rather than restating the regex. Same rule, same messages, one definition; the prototype's
     validation was written against it deliberately. If it cannot be imported across module folders,
     lift it to a shared location instead of copying it.
   - `skillSetApplyResultSchema` — `{ installed: array(skillRefSchema), skipped: array({ source, name, reason: z.enum(["source-not-connected", "not-in-source"]) }) }`.

   A closed `reason` enum, not a message: the client renders its own copy, and a string would be a
   server-authored sentence the UI has to trust. This mirrors how `ScanFailure` carries a verdict
   rather than prose.

3. **Repository.** New
   `packages/api-server/src/modules/skills/infrastructure/skill-sets-repository.ts`, modelled on
   [`skills-repository.ts`](../../../packages/api-server/src/modules/skills/infrastructure/skills-repository.ts)
   — the same owner-scoped shape, the same id prefix convention (`skill-set-<hex>`), and the same
   parse-on-read discipline. Methods: `list(owner)`, `get(id, owner)`, `create(input, owner)`,
   `delete(id, owner)`. Every method is owner-scoped; there is no unscoped read.

   A duplicate name must surface as a `CONFLICT` naming the existing set, not a raw unique-violation.

4. **Service — CRUD.** Add to
   [`skills-service.ts`](../../../packages/api-server/src/modules/skills/services/skills-service.ts):
   `listSets`, `createSet`, `deleteSet`. These touch no pod and take no `agentId` — a set belongs to
   the user, not a sandbox. Security-log create and delete: a set is a reusable instruction to fetch
   code from named repositories, so its creation is worth the same answerability as an install.

   Reject an entry list that is empty, and reject duplicate `(source, name)` pairs within one set.

5. **Service — apply.** `applySets(agentId, setIds[])` is the interesting part:

   - Union the entries of every named set. Deduplicate — two sets sharing `xlsx` install it once.
   - Resolve the sandbox's connected sources with the existing merged listing (`listSources(agentId)`),
     so system and template sources count too, not just the user's own rows.
   - For each distinct git URL in the union that **is** connected, scan it through the existing `list`
     dispatch — which is cached for five minutes and already handles the public-archive versus pod
     split. Do not add a second scan path.
   - Build the install list from entries found in their source's scan, taking `version` and
     `contentHash` **from that scan**. Skip entries already installed at the same hash — an apply that
     changes nothing must cost nothing.
   - Everything else is skipped with a reason: `source-not-connected` when the git URL is not among the
     sandbox's sources, `not-in-source` when it is but the scan no longer serves that name.
   - Call `applyBatch` from 02 with an **empty uninstall list**. This is the additive guarantee, and it
     is enforced here rather than trusted to callers.
   - A source whose scan fails is not a silent skip. Let the existing `ScanFailure` verdict propagate
     rather than reporting its skills as `not-in-source`, which would blame the set for a transport
     problem.

6. **Cleanup.** Sets outlive any sandbox, exactly as `skill_sources` does, so the `AgentDeleted`
   cleanup saga must **not** touch them. Confirm and note the finding rather than leaving it
   unexamined.

7. **Router.** Add a `sets` sub-router to
   [`router.ts`](../../../packages/api-server-api/src/modules/skills/router.ts), mirroring how
   `sources` is nested: `list`, `create`, `delete`, `apply`. `apply` takes an `agentId` and needs
   `checkAgentBinding`; the other three do not take one at all.

8. **Docs.** Add a **Skill Set** concept to
   [`docs/architecture/skills.md`](../../architecture/skills.md) under **Concepts**: what it holds, why
   it keys on git URL rather than source id, that it records names and never versions, that apply is
   additive by construction, and that skipped entries are reported rather than dropped. Add a bullet to
   the **api-server skills service** subsystem list. Note in **Persistence touchpoints** that
   `skill_sets` is per-user and survives agent deletion. Refresh `Last verified:`.

## Acceptance criteria

- [ ] `skill_sets` exists with a committed generated migration; `mise run db:check` passes.
- [ ] `skills.sets.create` accepts `document-processing`, rejects `My Set` with the same message a connection name would give, and rejects a duplicate name with `CONFLICT`.
- [ ] An empty entry list, and a set containing the same `(source, name)` twice, are both rejected.
- [ ] `list` returns only the caller's own sets; another user's set is invisible and not deletable.
- [ ] `apply` installs only the missing skills and never uninstalls anything, whatever the sandbox already has on.
- [ ] Applying two sets that share a skill installs it once.
- [ ] Applying a set whose skills are all already on performs no outbox bump.
- [ ] An entry whose git URL is not connected is reported `source-not-connected`; one whose source no longer serves the name is reported `not-in-source`.
- [ ] `apply` resolves versions from the source's current scan, not from anything stored on the set.
- [ ] A failing source scan surfaces its `ScanFailure` verdict rather than mislabelling its skills as skipped.
- [ ] Deleting a sandbox leaves the owner's sets intact.
- [ ] Set create and delete are security-logged.
- [ ] `skills.md` documents the concept, the service responsibility and the persistence touchpoint; `Last verified:` refreshed.

## Smoke test

```bash
mise run check && mise run test
```

Then on the dev cluster, using an authenticated tRPC call (mint a token via the `platform-ui`
password grant per the `cluster-ops` skill):

1. Create a set naming three skills from a connected source. Confirm the name rules by trying
   `My Set` and a duplicate.
2. Apply it to a second sandbox that has the same source connected but none of the skills. All three
   install; the returned `skipped` list is empty.
3. Apply it again. Nothing installs, `skipped` is empty, and the outbox version does not move.
4. Remove the source from that sandbox and apply again. All three come back as
   `source-not-connected`.
5. Delete the sandbox and confirm the set still lists.

Print a short manual smoke-test guide so the user can confirm it by hand.
