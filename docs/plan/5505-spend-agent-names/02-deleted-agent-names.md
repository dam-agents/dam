# 02 — Deleted agents keep their last known name

**Depends on:** 01-sub-agent-row-names
**Part of:** Spend by agent names every agent — see [README](./README.md)

## Context

After slice 01, an agent row shows the Invocation title or the live name, and a deleted agent that is not a sub-agent still shows as "Deleted agent".
This slice keeps the name that each Agent resource had when it went, in a spend-owned table, and adds it as the third source of the name order.
The api-server's Agent watch is the capture point, because it sees every way that an Agent goes and its delete observation carries the last state of the resource.
After this slice, a deleted agent keeps its last known name on Home, on Settings › Usage and in its driver's Usage section.

## Implementation plan

Apply `/typescript-engineering` throughout.

1. **Table.**
   In `packages/db/src/schema.ts`, next to the spend tables, add a table for the last known names, for example `spend_agent_names`: `agent_id` (primary key), `owner_sub` (the raw sub, as in `spend_daily`), `name`, and the time the Agent went.
   The read looks up by agent id and owner, so the primary key is the only index it needs.
   Run `mise run //packages/db:generate` and add the top comment that says why the table exists: a ledger row outlives its agent, and this keeps the agent's name with it.
   Do not hand-edit the generated SQL, the journal or the snapshot.

2. **Event.**
   In `packages/api-server/src/events.ts`, add an event for "the api-server's Agent watch saw an Agent resource go", for example `AgentResourceRemoved { agentId, ownerSub, name }`, to the `EventType` enum and the `DomainEvent` union.
   Do not reuse `AgentDeleted`: the API delete path and the orphan sweep emit that event, its subscribers (the live UI hint, the Slack worker registration) expect one event per delete, and every replica's watch would add another.

3. **Watch observer.**
   In `packages/api-server/src/modules/agents/infrastructure/`, add an observer next to `out-of-memory-watch.ts` and `ready-watch.ts`, with the same `(kind: AgentObservation, obj: KubeObject) => void` shape.
   On `"delete"` only, it reads the id, the owner (`agentOwner(obj)` in `agent-mappers.ts`) and the name (`parseInfraAgent(obj).name`, which falls back to the id when the spec names none), and emits the event.
   It skips an object with no id or no owner.
   Wire it into the `observe` callback of `startAgentStateCache` in `packages/api-server/src/bootstrap.ts`, next to `outOfMemoryWatch` and `readyWatch`.
   The `ListWatch` relist reports an object that went while the watch was down as a delete too, so a dropped watch connection loses no name.

4. **Repository.**
   In `packages/api-server/src/modules/spend/infrastructure/`, add a repository with two operations:
   - keep a name: an upsert on the agent id that sets the owner, the name and the time, so a write from each replica, or a replay, leaves one row;
   - read names: for an owner and a list of agent ids, return a map from id to name.

5. **Saga.**
   In `packages/api-server/src/modules/spend/sagas/`, add a saga that subscribes to the event and keeps the name, in the shape of `extend-on-continue.ts`: `concatMap`, catch and log an error with a `spend.` log key, never crash.
   Start it in `composeSpendSystem` (`packages/api-server/src/modules/spend/compose.ts`) and return its subscription on `SpendSystem`, as `extendSaga` is returned.
   Unsubscribe it at shutdown in `packages/api-server/src/bootstrap.ts`, next to `spend.extendSaga.unsubscribe()`.
   Record every Agent that goes, temporary targets included: the watch needs no rule about what a target is, and a target's row is only read when its Invocation record is gone.

6. **Third name source.**
   In `breakdown()` of `packages/api-server/src/modules/spend/services/spend-service.ts`, read the last known names for the ids in the rows, in parallel with the Invocation titles, and add them to the name merge from slice 01 after the live names.
   The live name wins, so an id that a new Agent reuses shows the new Agent's name.

7. **Activity events page.**
   Run `mise run //docs:fix:activity-events` to regenerate `docs/activity-events.md`: the new event appears as consumed *elsewhere*, fired from agents.
   `mise run //packages/api-server:check:events` passes because the event has one emit site and one subscriber.

8. **Docs.**
   - `docs/architecture/spend-limits.md`, Ledger (after "A row outlives its agent, so the spend of a deleted agent still counts for its owner."): the api-server also keeps the last name of each Agent that goes, from its Agent watch, which sees every way an Agent is deleted; a delete that no api-server replica sees leaves the agent with no name.
   - `docs/architecture/spend-limits.md`, Grouped read: add the last known name to the name order from slice 01, after the live name.
   - `docs/architecture/spend-limits.md`, Screens: a deleted agent keeps its last name beside a greyed avatar, and an agent with no recorded name shows as "Deleted agent".
   - Do not edit `docs/architecture/persistence.md`: it is 7 letters under its size cap, and its "kept on purpose" list already names the spend ledger.
   - Bump `Last verified:` and run `mise run fix:markdown`.

## Acceptance criteria

- [x] `mise run //packages/db:check:generated` passes, and the migration is generated, not hand-written.
- [x] Deleting an Agent through the UI, through `kubectl delete`, and by an Invocation reap each leaves one row with its last name in the new table.
- [x] A second api-server replica, or a replayed event, leaves one row per agent.
- [x] `spend.breakdown` returns the last known name as `agentName` for a deleted agent, and the live name for a live agent whose id has a row in the table.
- [x] An Invocation title still wins over the last known name of a reaped sub-agent.
- [x] `docs/activity-events.md` lists the new event, and `mise run //docs:check:activity-events` and `mise run //packages/api-server:check:events` pass.
- [x] `docs/architecture/persistence.md` is unchanged.
- [x] `mise run check` and `mise run test` pass, and `mise run check:comment-types` passes.

## Smoke test

1. Run `mise run //packages/db:check`, `mise run //packages/api-server:check`, `mise run //docs:check:activity-events`, then `mise run //packages/api-server:test`.
2. Build and roll out: `mise run cluster:build -- api-server`.
   The api-server applies the migration at startup.
3. In the dev app (`http://localhost:4444`), create an agent, give it a name you can recognize, send it one message so that it spends, then delete it from the UI.
4. Open Settings › Usage: "Spend by agent" shows that name beside a greyed avatar.
   On Home, set the spend card to Today: the agent shows under its name when it is among the top three.
5. Create a second agent, let it spend, and delete it with `mise run cluster:kubectl -- delete agents.<group> <agent-id> -n <agents namespace>` (take the resource name and namespace from `mise run cluster:kubectl -- get agents -A`).
   Settings › Usage shows its name too.
6. In the cluster's Postgres pod, read the new table (`select agent_id, name from spend_agent_names`): one row for each agent from steps 3 and 5, and one for each temporary sub-agent reaped since the rollout.

Then print a short manual guide so the user can repeat steps 3–5 by hand.
