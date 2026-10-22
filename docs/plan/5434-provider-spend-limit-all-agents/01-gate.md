# 01 — All-agents provider limit in the gate

**Part of:** Provider spend limit for all agents — see [README](./README.md)

## Context

The backend of the new limit: scope `owner-connection` (one Connection, every agent of its owner),
counted per UTC day in the Connection's unit, enforced by the same gate, holds and continue
questions as the other soft limits, and settable through `spend.setLimit`.
No UI beyond the Home
question text; verified through `dam spend limit` and `dam spend status`.

## Implementation plan

Apply **/typescript-engineering**.

1. **Contract** — `packages/api-server-api/src/modules/spend/schemas.ts`: add
   `z.object({ kind: z.literal("owner-connection"), connectionId: z.string().min(1) })` to
   `spendLimitScopeSchema`.
   Add `ownerSpentByConnection: SpendConnectionTotal[]` to `SpendStatus`
   in `types.ts`.
   Run the type-check: every exhaustive `match` on the scope now fails to compile —
   that list is the work list for the rest of this slice (UI ones get a minimal case here; 03/04
   design them).
2. **Domain** — `packages/api-server/src/modules/spend/domain/limits.ts`: add the scope to
   `LimitScope`; `limitCounter` maps it to the new counter; `limitsOnCall` matches
   `limit.ownerSub === call.ownerSub && scope.connectionId === call.connectionId` (unit equality
   is already checked).
3. **Ledger** — `domain/ledger.ts`: add the `owner-connection` `DayCounter` variant and emit it from
   `dayCountersOf`.
   `infrastructure/day-counters.ts`: key `spend:${day}:ownerconn:${ownerSub}:${connectionId}`.
   `infrastructure/spend-ledger.ts` `total`: `day`, `owner_sub`, `connection_id` (the
   `spend_daily_owner_day_idx` index covers it).
   Add `byOwnerConnection({ ownerSub, day })`
   grouped by Connection and unit, mirroring `byConnection`.
4. **Repository** — `infrastructure/spend-limits.ts`: `scopeColumns`/`scopeOf` for the new kind
   (`agentId` null).
   `applying` returns `owner` and `owner-connection` rows for every caller (they
   are owner-wide), plus the agent's own rows when `agentId` is set.
   Add
   `deleteForConnection(ownerSub, connectionId)` removing both `connection` and `owner-connection`
   rows of that Connection.
5. **Service** — `services/spend-service.ts`:
   - `limitUnit`: for `owner-connection`, resolve the template of a Connection **the caller owns**
     (extend the `GrantedConnections` port with `ownedTemplateOf(ownerSub, connectionId)`; the
     connections module already lists an owner's Connections), `NOT_FOUND` when not theirs, the
     existing `connectionLimitRefusal` when it takes no limit.
   - `setLimit`: the `scope.kind !== "owner"` branch must not call `requireOwned` for
     `owner-connection` (there is no agent).
   - `status`: fill `ownerSpentByConnection` from `byOwnerConnection` (always, with or without
     `agentId`).
6. **Cleanup** — subscribe to `EventType.ConnectionRemoved` in the spend module (a saga next to
   `sagas/extend-on-continue.ts`) and call `deleteForConnection`; close pending questions of the
   deleted limits as `setLimit` does.
7. **Refusal and holds** — `domain/refusal.ts` and `services/spend-check.ts` need no logic change;
   check the refusal text and `channels/infrastructure/spend-hold-copy.ts` read correctly for the
   new scope and add a case where they switch on scope.
8. **Home question** — `packages/ui/src/modules/home/lib/approval-copy.ts`: name
   `` `Your ${name} spend limit (all agents)` `` and detail
   "Calls of all your agents on this provider stop until you continue or the day ends.
   Continue lets
   all of them go on."
   Add the name helper to `spend/lib/copy.ts`.
9. **CLI set/clear** — `packages/cli/src/modules/spend/commands/limit.ts`: `--me --connection <c>`
   targets `{ kind: "owner-connection", connectionId }` with `--amount` in the Connection's unit
   (today `--me` rejects `--connection`).
   Texts: "Your ‹name› spend limit (all Agents) is now
   ‹amount› a day."
   / "…is removed."
   Fix the `set` description and the agent-limit `setText` that
   say the subscription and Bob "need a Connection limit" — a limit for all agents works too.
   `commands/status.ts` renders the new scope ("Your Anthropic limit (all Agents)").
10. **Agent tool compiles** — `harness-api-server/spend-limits-tool.ts`: the scope passes through
    as is; 02 adds the stops-first view.
11. **Docs** — `docs/architecture/spend-limits.md`: under **Limits**, add "Provider limit for all
    agents" and fix the table column and the sentence "So the Claude subscription and Bob are
    limited only by their Connection limits"; **Day counters** gains per owner and Connection;
    bump `Last verified:`.
    Run `/doc-drift`.

## Acceptance criteria

- [ ] `spend.setLimit({ scope: { kind: "owner-connection", connectionId }, amountMicros })` stores
  one limit per owner and Connection; a second call replaces it; `null` removes it.
- [ ] `dam spend limit set|clear --me --connection <c>` sets and removes it; `dam spend status`
  lists it.
- [ ] Setting it on another user's Connection fails `NOT_FOUND`; on a free or unpriced Connection it
  fails with the existing refusal text.
- [ ] A call of any of the owner's agents on that Connection is refused once their summed spend
  today reaches the limit; calls on other Connections are not.
- [ ] Sub-agent calls and calls of an agent deleted today count toward it (rollup-based rebuild).
- [ ] At the limit, one Home question per limit and day; Continue raises it for every agent.
- [ ] Schedules, spawns and channel turns are held at it like the other soft limits.
- [ ] Removing the Connection deletes its limits.
- [ ] `spend.status` returns `ownerSpentByConnection`.
- [ ] `mise run check` and `mise run test` pass; `/doc-drift` is clean.

## Smoke test

`mise run test` and `mise run check` against the current suite (the spend domain tests cover
`limitsOnCall` and the counters by kind, so the new kind must compile through them).

Then on a local cluster, with an Anthropic key Connection and two agents on it:

```sh
dam spend limit set --me --connection anthropic --amount 0.05
dam spend status --json | jq '.limits, .ownerSpentByConnection'
```

Run turns on both agents until the summed spend passes $0.05: the next call of either agent stops
with "Spend limit reached", and Home shows the question naming "Your Anthropic spend limit (all
agents)".
Disconnect the Anthropic Connection: `dam spend status` no longer lists the limit.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
