# 04 — Skills snapshot read

**Depends on:** 01 (mirrors its write-on-change repo pattern; no shared column)
**Part of:** cached agent-resolved settings — see [README](./README.md)

## Context

`skills.state` already returns `installed` from Postgres while the agent is stopped — those are
`agent_skills` rows. What it cannot return is `standalone`: skills created in the sandbox and skills
baked into the image both live on the pod's disk, so a stopped sandbox reports an empty list
([`skills-service.ts`](../../../packages/api-server/src/modules/skills/services/skills-service.ts),
`getState`). The Skills surface works around this by rendering a placeholder and treating an empty
list as "the list is on the offline pod".

This slice records that list while the sandbox runs and serves it while it is stopped.
[#3208](https://github.com/dam-agents/dam/issues/3208) renders it; **this slice deliberately ships no
UI change**, so the existing surface keeps its placeholder.

Apply the `/typescript-engineering` skill.

## Implementation plan

1. **Schema.** Add `skillsSnapshot: jsonb("skills_snapshot")` to the `agents` table in
   [`packages/db/src/schema.ts`](../../../packages/db/src/schema.ts), beside `harnessConfigSnapshot`
   from 01. Its own column, not a shared blob — the two are written by different modules on different
   triggers, and 01 must not become a dependency of this one at the data level. Generate the
   migration with `mise run db:generate` and commit it with the schema change.

2. **Contract.** In
   [`packages/api-server-api/src/modules/skills/schemas.ts`](../../../packages/api-server-api/src/modules/skills/schemas.ts),
   add an optional snapshot marker to the state schema (~line 159):

   ```ts
   /** Present only when `standalone` came from a recorded snapshot rather than
    *  a live pod read — the sandbox is stopped. Absent while running. */
   standaloneSnapshot: z.object({ capturedAt: z.string().datetime() }).optional(),
   ```

   Absent-while-running is what lets a reader tell live truth from a snapshot without a second field
   for the running case. Reuse the existing `localSkillSchema` for the entries — `origin` and
   `contentHash` are already optional there, so a snapshot taken from an older pod round-trips.

3. **Repository.** Add read and write-on-change methods for the column to
   [`agent-skills-repository.ts`](../../../packages/api-server/src/modules/skills/infrastructure/agent-skills-repository.ts).
   Mirror 01's `merge` semantics: compare the incoming list against the stored one and skip the write
   when nothing changed apart from the timestamp. **This matters more here than in 01** — the Skills
   surface polls `skills.state` every 5 seconds while open
   ([`use-skills-surface.ts:202`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts:202)),
   so an unconditional write would be one row update per open page per 5 seconds. Compare on the
   fields that matter (name, description, origin, contentHash), not on object identity or key order.

4. **Service.** In `getState`:

   - **Running branch:** after `local` is fetched and `standalone` computed, record it. Record the
     computed `standalone`, not the raw `local` — that is what the read side must return, and it is
     already reconciled against tracked names. Swallow and log a write failure: the snapshot is
     display state and must not break the page's primary read.
   - **Stopped branch:** return the recorded list plus `standaloneSnapshot: { capturedAt }` instead of
     `standalone: []`. When there is no snapshot, keep returning `[]` with no marker — that is a
     never-run sandbox, and it must not read as "the sandbox has no skills".
   - Do **not** reconcile against the snapshot. Reconciliation drops `agent_skills` rows whose
     directories are gone, and the existing comment is explicit that a stopped pod must not trigger it.
     A snapshot is not evidence about the current disk.

5. **Cleanup.** Confirm the skills cleanup saga needs no change
   ([`skills-cleanup.ts`](../../../packages/api-server/src/modules/skills/sagas/skills-cleanup.ts)) —
   the column lives on the `agents` row, which agent deletion already handles, so there is nothing new
   to reap. Note the finding either way rather than leaving it unexamined.

6. **Check the existing surface still behaves.** `standalone` becoming non-empty while stopped changes
   an input the current surface reasons about: `skills-surface.tsx` computes `isEmpty` with
   `!readOnly && … && standalone.length === 0`, and splits `standalone` into `createdHere` and
   `builtIn` by `origin`. The `!readOnly` guard means the empty state is unaffected, and the split is
   origin-driven so a snapshot with origins renders correctly if it ever reaches those groups. Verify
   this by inspection and leave the components untouched.

7. **Docs.** Update the **Reconciled state** section of
   [`docs/architecture/skills.md`](../../architecture/skills.md): while the pod is unreachable, `state`
   serves a recorded snapshot of the local list, dated and marked as such, and it never reconciles
   from it. Refresh `Last verified:`.

## Acceptance criteria

- [ ] `agents.skills_snapshot` exists with a committed generated migration; `mise run db:check` passes.
- [ ] While running, `skills.state` is unchanged: live `standalone`, no `standaloneSnapshot` marker.
- [ ] While stopped, `skills.state` returns the last recorded standalone list with each entry's `origin`, plus a `capturedAt`.
- [ ] A never-run sandbox returns `standalone: []` with **no** marker, distinguishable from a snapshot recording an empty list.
- [ ] Repeated `skills.state` polls against an unchanged sandbox perform no writes.
- [ ] The stopped branch performs no `agent_skills` reconciliation.
- [ ] No component under `components/skills/` changes behaviour. The stopped surface *does* gain the recorded groups, because `standalone` becoming non-empty is an input the existing origin-driven split already renders — agreed during implementation; #3208 restyles it rather than enabling it.
- [ ] `skills.md` documents the snapshot; `Last verified:` refreshed.

## Smoke test

```bash
mise run check && mise run test
```

Then on the dev cluster: start a sandbox, create a standalone skill by dropping a `.md` file on the
Skills page, and confirm it lists. Stop the sandbox and call `skills.state` — the skill comes back
with its `origin` and a `capturedAt`, while the page itself still shows the read-only placeholder.
Poll `skills.state` several times against the stopped sandbox and confirm no row updates.

Print a short manual guide so the user can repeat this by hand.
