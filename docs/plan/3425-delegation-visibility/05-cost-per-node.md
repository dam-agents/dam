# 05 — Cost per node from telemetry

**Depends on:** 04-read-path
**Part of:** Delegation visibility — see [README](./README.md)

## Context

A child's spend is attributed to its root driver at write time, and its gateway stamps the
trusted `platform.invocation.id` on every row so the merged child rows stay distinguishable
(observability § Trusted attribution). No read uses that stamp yet: the metrics reader's one
mention of it is a display-name tiebreaker. This slice adds the per-invocation read and the
tRPC procedure the block calls next to the tree. Cost is live, not stored, and ages out with
the telemetry store like every other cost view.

Apply `/typescript-engineering`.

## Implementation plan

1. **Reader port** — `packages/api-server/src/modules/metrics/services/metrics-service.ts:49-91`,
   `MetricsReader`. Add
   `spendByInvocation(agentIds, invocationIds, window): Promise<InvocationSpendRow[]>`
   where a row is `{ invocationId, costUsd, inputTokens, outputTokens, calls }`.
2. **ClickHouse** — `packages/api-server/src/modules/metrics/infrastructure/clickhouse-reader.ts`.
   Model the query on `runtimeBySession` (:239-304) minus the session fold: `otel_logs`,
   `Body = 'claude_code.api_request'`, the `AGENT_GATE` on the root driver ids, plus
   `ResourceAttributes['platform.invocation.id'] IN {invocationIds}`, `GROUP BY` the
   invocation id, summing the same token and cost columns. Window bounds as the other reads.
   Add the same method to any other `MetricsReader` implementation the tests use.
3. **Service** — `createMetricsService` gains `invocationSpend(driverAgentId, ids)`: resolve
   the root driver the same way slice 04 does (the invocation module exposes it on the
   query service; inject that function rather than the repository), call the reader with
   `agentIds = [root]` and a window of the telemetry retention, and shape the map.
4. **Contract** — `packages/api-server-api/src/modules/metrics/schemas.ts` and
   `router.ts`: `invocationSpend` input `{ driverAgentId, ids (max 200) }`,
   `readAgentProcedure` + `checkAgentBinding(ctx, input.driverAgentId)`, output as pinned in
   the README.
5. **Docs** — `docs/architecture/metrics.md`: one sentence under the reads, that a per
   invocation spend read groups the root driver's rows by the trusted invocation stamp.

## Acceptance criteria

- [ ] For the README fan-out, `metrics.invocationSpend` returns one entry per child with a
      non-zero cost and call count once telemetry flushed; the sum is at most the driver's
      session cost for the same window.
- [ ] An id with no telemetry rows is absent from the map, not zero.
- [ ] With the telemetry store unreachable the procedure fails the same way
      `metrics.overview` does, so the UI's existing unavailable handling applies.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run test` and `mise run check`. On the dev cluster, a minute after the README prompt
finishes, call `metrics.invocationSpend` for the driver and the two ids from the devtools
tRPC client as in slice 04, and compare against `metrics.overview` for the driver: the two
children together cost less than the driver's session total.
