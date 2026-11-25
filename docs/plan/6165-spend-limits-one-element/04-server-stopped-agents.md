# 04 — Server: which agents a limit stopped

**Part of:** Spend and limits read as one thing — see [README](./README.md)

## Context

The sidebar (05) needs, for every agent of the owner, whether a limit has stopped one of its sessions today and which limit.
Today `spend.status` answers it for one agent at a time; polling it per sidebar row would cost one query per agent every 15 s.
This slice adds the owner-level `spend.stopped` query pinned in the README.

## Implementation plan

Apply `/typescript-engineering`.

1. **Contract.** Add `SpendStoppedLimit`, `SpendStoppedAgent`, `SpendStopped` to `packages/api-server-api/src/modules/spend/types.ts` exactly as the README pins them, `stopped(): Promise<SpendStopped>` to the spend service interface there, and `stopped: readAgentProcedure.query(({ ctx }) => ctx.spend.stopped())` to `router.ts`, beside `status`.
   With an agent binding other than `*` (an agent's own key), answer only that agent, as `status` does with `checkAgentBinding`.
2. **Ledger read.** Add to `SpendLedger` (`packages/api-server/src/modules/spend/infrastructure/spend-ledger.ts`) a read of today's refusals: rows of `spend_daily` with `refused_calls > 0` for the owner and day, grouped by payer agent, Connection and Session (`{ payerAgentId, connectionId, sessionId }[]`).
   No migration: the columns exist (`addRefusal`).
3. **Service.** In `services/spend-service.ts`, `stopped()`:
   - read today's refusals, the owner's applying limits for each payer agent (`deps.limits.applying({ agentId, ownerSub }, day)` — or one read of all the owner's limits, filtered per agent), and the ceiling;
   - for each payer agent with refusals, build the candidates that count its refused calls on each refused Connection (agent, connection, owner-connection, owner, ceiling) with `limitView`/`ceilingView`, keep those `state === "reached"`, and pick one with `domain/binding.ts`'s ordering (least left, then narrowest — reuse `bindingFrom`/`NARROWNESS` rather than a copy);
   - an agent with refusals but no reached limit now is not stopped (the owner raised it, removed it or continued);
   - return `{ resetsAt: nextUtcMidnight(now).toISOString(), agents }`, `sessionIds` de-duplicated.
   Put the pure selection in `domain/` (e.g. `domain/stopped.ts`) so it is testable without a database.
4. **Docs.** `docs/architecture/spend-limits.md` → **Refusal** or **Continue**: one paragraph on what "stopped" means and that the UI reads it per owner.

## Acceptance criteria

- [ ] `spend.stopped` returns an agent with a refused call today while a limit counting it is reached, naming that limit and its Connection.
- [ ] Raising or removing that limit, or continuing, drops the agent at the next read.
- [ ] A refusal on one provider whose limit is reached names that provider's limit; the ceiling is named as `kind: "ceiling"`.
- [ ] Only the caller's agents are returned.
- [ ] `mise run //packages/api-server-api:check`, `//packages/api-server:check`, their `:check:format`/`:check:lint`, `//:check:comment-types`, and `//packages/api-server:test` pass.
- [ ] **Exception — a new unit test** for the pure selection in `domain/` (refusal + reached / refusal + raised / two reached limits, narrowest wins), beside `spend-binding.test.ts`: the rule has edge cases no screen shows on its own.

## Smoke test

`mise run //packages/api-server:test`.
On the local cluster: set a $0.01 agent limit, send a message, then call `spend.stopped` through the UI's devtools network tab (or the CLI if it exposes spend) and see the agent with `kind: "agent"`; raise the limit and see it gone.
