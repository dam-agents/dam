# 05 — Telemetry per node

**Depends on:** 04-read-path
**Part of:** Delegation visibility — see [README](./README.md)

## Context

Every assistant reply already carries a telemetry line when the `agent-telemetry` feature
is on: duration, calls, tokens and cost, with a chevron that opens the turn's waterfall.
It is fed by `telemetry.turns`, which groups a session's records into turns. A child's
records are attributed to the root driver at write time and stamped with the trusted
`platform.invocation.id`, so they are already in the store; no read groups by that stamp
yet. This slice adds the read that returns one `TurnSummary` per child, covering its whole
run, so the Delegation block renders the same line with the same component and nothing new
is invented for cost.

Apply `/typescript-engineering`.

## Implementation plan

1. **Reader port** — `packages/api-server/src/modules/telemetry/services/telemetry-service.ts`
   and its ClickHouse reader `infrastructure/clickhouse-telemetry-reader.ts`. Add a read
   that, for a root driver and a set of invocation ids, folds every `otel_logs` and
   `otel_traces` row where `ResourceAttributes['platform.invocation.id']` is in the set
   into one turn per id: first and last timestamp, duration, call count, token sums, cost,
   error count, models, trace ids. Reuse the aggregation `turns` already applies per turn
   (`domain/group-turns.ts`); the only difference is the grouping key.
2. **Scoped detail** — `telemetryTurnInputSchema` gains `invocationId?: string`. When set,
   `telemetry.turn` restricts spans and logs to rows carrying that stamp instead of the
   session and prompt id, so `TurnTelemetry`'s detail (waterfall, span and record detail)
   opens for a child unchanged.
3. **Service** — `invocationTurns(driverAgentId, ids)`: resolve the root driver the way
   slice 04 does (inject the resolver from the invocations module), run the read with
   `agentIds = [root]`, return `{ available: true, turns }` keyed by id, or the same
   `{ available: false, reason }` shape `turns` returns when the store is unreachable or
   the feature is off.
4. **Contract** — `packages/api-server-api/src/modules/telemetry/schemas.ts` and
   `router.ts`: `invocationTurns` input `{ driverAgentId, ids (max 200) }`,
   `readAgentProcedure` + `checkAgentBinding(ctx, input.driverAgentId)`, output as pinned
   in the README.
5. **Docs** — `docs/architecture/metrics.md` (or wherever the telemetry reads are
   described): one sentence that a per-child read groups the root driver's records by the
   trusted invocation stamp and returns them in the turn shape.

## Acceptance criteria

- [ ] For the README fan-out, `telemetry.invocationTurns` returns one `TurnSummary` per
      child with non-zero calls and cost once telemetry flushed. A child's rows carry its own
      session id, so its cost is not inside the driver's session turns; it is inside the
      driver's agent-level spend, which is where to cross-check.
- [ ] A child with no rows is absent from the map, not zero.
- [ ] `telemetry.turn` with `invocationId` returns only that child's spans and logs.
- [ ] With the telemetry store unreachable the procedure returns `available: false` with
      a reason, as `turns` does.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run test` and `mise run check`. On the dev cluster with ClickStack enabled and the
`agent-telemetry` feature on, a minute after the README prompt finishes, call
`telemetry.invocationTurns` for the driver and the two ids from the devtools tRPC client as
in slice 04. Verified 2026-09-24: both children of the 09:04 fan-out returned 3 calls and
$0.0734 each with their models listed, and `telemetry.turn` scoped by `invocationId` returned
only that child's 11 records.
