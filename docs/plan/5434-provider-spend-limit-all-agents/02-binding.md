# 02 — Which limit stops first, from the server

**Depends on:** 01-gate
**Part of:** Provider spend limit for all agents — see [README](./README.md)

## Context

Today only the browser works out "this other limit stops the agent first", in dollars only
(`packages/ui/src/modules/spend/lib/nearer-limit.ts`).
This slice moves that rule into
`spend.status` as `binding` (contract pinned in the README), across every unit and Connection,
and makes the agent's `describe_spend_limits` tool and `dam spend status` show it.

## Implementation plan

Apply **/typescript-engineering**.

1. **Pure rule** — new `packages/api-server/src/modules/spend/domain/binding.ts`:
   `bindingOf(readings, ceiling, agentId, connections)` returns one `SpendBinding` per
   (Connection, unit) the agent holds a reading for, plus one for the agent's dollars across
   Connections (`connectionId: null`):
   - Dollar Connection: candidates are its `connection` limit, its `owner-connection` limit, the
     `agent` limit, the `owner` limit and the ceiling.
   - Subscription / Bob Connection: its `connection` and `owner-connection` limits only.
   - The `null` row: `agent`, `owner`, ceiling.
     `stopsFirst` is the candidate with the least `leftMicros`; ties go to the narrower scope
     (`connection` < `agent` < `owner-connection` < `owner` < ceiling) so the screen names the limit
     the user set closest to the agent.
     `others` lists the rest.
     No candidate → no row.
     This is the one place with tricky edges, so add a unit test next to the existing spend domain
     tests (`packages/api-server/src/__tests__/unit/`) — the flagged exception to "no new tests".
2. **Status** — `services/spend-service.ts` `status`: when `input.agentId` is set, read the agent's
   granted Connections (the port already gives templates per grant) and fill
   `binding: bindingOf(...)`; without an agent, `binding: []`.
   Add `SpendBinding` to
   `api-server-api` `types.ts` and export it.
3. **Agent tool** — `apps/harness-api-server/spend-limits-tool.ts`: add to `readable` a
   `stopsFirst` list: per binding, the Connection name (or "all paid providers"), what is left in
   its unit, and the limit's name in words ("your owner's limit for all agents on Anthropic").
   Update `DESCRIPTION`: drop "a Connection limit counts that Connection's unit" as the only
   provider-wide rule; say that a provider can carry a limit for one agent and one for all of the
   owner's agents, and that the one with the least left stops calls first.
4. **CLI status** — `packages/cli/src/modules/spend/commands/status.ts`: with an agent, print one
   "Stops first:" line per binding row; keep `--json` emitting the raw status.
5. **Docs** — `docs/architecture/spend-limits.md` **The agent's view** and `docs/architecture/cli.md`
   if it lists the spend commands: the stops-first rule and the new flag combination.

## Acceptance criteria

- [ ] `spend.status({ agentId })` returns `binding` rows; `spend.status({})` returns `binding: []`.
- [ ] With an agent limit $5 (spent $1.10) and an all-agents Anthropic limit $20 (spent $19.50),
  the Anthropic row names `owner-connection` with $0.50 left and lists the agent limit in
  `others`.
- [ ] A subscription or Bob row never names `agent`, `owner` or the ceiling.
- [ ] `describe_spend_limits` shows the stops-first line per provider.
- [ ] `dam spend status <agent>` prints "Stops first" lines.
- [ ] The new `binding` unit test and `mise run check`, `mise run test` pass.

## Smoke test

`mise run test` (includes the new `binding` test) and `mise run check`.

Then on a local cluster with the 01 setup:

```sh
dam spend limit set --me --connection anthropic --amount 0.05
dam spend limit set agent-a --connection anthropic --amount 5
dam spend status agent-a          # "Stops first: Your Anthropic limit (all Agents) — $… left"
dam spend limit clear --me --connection anthropic
dam spend status agent-a          # now names agent-a's own Anthropic limit
```

In a chat with agent A, ask it to call `describe_spend_limits`: its answer names the same limit.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
