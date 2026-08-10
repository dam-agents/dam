# 02 — Batch install and uninstall

**Part of:** search, bulk-toggle and skill sets — see [README](./README.md)

## Context

Enabling a source's 22 skills today means 22 procedure calls: 22 wakes, 22 outbox bumps, 22 reconcile
settles, and a toggle that fights the surface's 5-second poll the whole way. Install is declarative
though — a row upsert plus a bump, with the apply worker doing the fetch — so one batch is N row
writes and **one** bump. This slice adds that procedure. It is the primitive 03 and 04 both build on.

Apply the `/typescript-engineering` skill.

## Implementation plan

1. **Contract.** In
   [`packages/api-server-api/src/modules/skills/schemas.ts`](../../../packages/api-server-api/src/modules/skills/schemas.ts):

   ```ts
   export const skillApplyBatchInputSchema = z.object({
     agentId: z.string().min(1),
     install: z.array(
       z.object({
         source: z.string().url(),
         name: z.string().min(1),
         version: z.string().min(1),
         contentHash: z.string().optional(),
       }),
     ),
     uninstall: z.array(
       z.object({ source: z.string().url(), name: z.string().min(1) }),
     ),
   });
   ```

   One procedure taking both lists rather than two procedures. A mixed change then costs one apply
   cycle instead of two, and 04's set apply gets a single primitive to call. Cap both arrays with
   `.max()` at a size comfortably above any real source (a few hundred) so a malformed client cannot
   ask for unbounded work.

   Add `applyBatch` to `SkillsService` in
   [`types.ts`](../../../packages/api-server-api/src/modules/skills/types.ts), returning
   `SkillRef[]` — the same authoritative full list `install` returns today, which is what the surface
   sets its state from.

2. **Router.** Add `applyBatch` to
   [`router.ts`](../../../packages/api-server-api/src/modules/skills/router.ts) beside `install` and
   `uninstall`, on `manageAgentsProcedure`, with the same `checkAgentBinding` call those two use.

3. **Service.** Add `applyBatch` to
   [`skills-service.ts`](../../../packages/api-server/src/modules/skills/services/skills-service.ts),
   modelled on `install`/`uninstall` (~lines 631–695):

   - **One** `ensureAgentReachable`, not one per entry.
   - **Hoist the source resolution.** `resolveSourcePathByGitUrl` (~line 233) lists owned sources and
     template sources on every call. Called per entry that is N× the work for one answer, so resolve
     the merged source list once and look each git URL up against it.
   - Upsert every install row and remove every uninstall row.
   - Then **one** `runtimeMutator.bump(agentId, [])` and **one** `enqueueAfterCommit`. This is the
     whole point of the slice; a bump per entry would defeat it.
   - **Keep the security log per skill.** The existing `skill.install` / `skill.uninstall` entries
     exist so "what did this agent install, from where" is answerable after an incident. One
     aggregate line for a batch would lose that. Same category, same fields, one per entry.
   - Return `listSkills(agentId)` — read the full list back rather than folding the batch into the
     previous array by hand, which is where an off-by-one in `upsertSkillRef`/`removeSkillRef`
     composition would hide.
   - An entry appearing in both lists is a client bug. Reject the whole batch with `BAD_REQUEST`
     naming the offender rather than picking a winner.

4. **Empty batch.** Both lists empty is a no-op: no bump, no enqueue, no log. 04's apply relies on
   this — a set whose skills are all already on must cost nothing.

5. **Docs.** In the **api-server skills service** section of
   [`docs/architecture/skills.md`](../../architecture/skills.md), extend the install/uninstall bullet:
   a batch variant applies many changes under one outbox bump, so a bulk action settles once; the
   security log stays per skill. Refresh `Last verified:`.

## Acceptance criteria

- [ ] `skills.applyBatch` installs and uninstalls many skills in one call and returns the full updated `SkillRef[]`.
- [ ] The call performs exactly one outbox bump and one enqueue regardless of entry count (verify from the runtime-delivery log or the outbox row's version advancing by one).
- [ ] `ensureAgentReachable` runs once per call.
- [ ] The merged source list is resolved once, not once per entry.
- [ ] One security-log entry per installed and per uninstalled skill.
- [ ] A batch with both lists empty writes nothing and bumps nothing.
- [ ] A name present in both `install` and `uninstall` is rejected with `BAD_REQUEST` naming it.
- [ ] The batch refuses an agent the caller does not own, and an agent in an error state, exactly as `install` does.
- [ ] `skills.md` documents the batch; `Last verified:` refreshed.

## Smoke test

```bash
mise run check && mise run test
```

Then on the dev cluster: call `skills.applyBatch` for a running sandbox with several installs from one
source (mint a token via the `platform-ui` password grant per the `cluster-ops` skill). Confirm every
skill lands on the pod, the returned list matches, and the outbox version advanced by one rather than
once per skill. Repeat with an empty batch and confirm nothing moves.

Print a short manual smoke-test guide so the user can confirm it by hand.
