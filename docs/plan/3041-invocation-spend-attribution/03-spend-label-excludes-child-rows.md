# 03 — Spend-by-agent label excludes child rows

**Depends on:** 01-gateway-attribution-override
**Part of:** Invocation spend attribution — see [README](./README.md)

## Context

Once target rows carry the Driver's `platform.agent.id`, the per-agent label — the
latest `platform.agent.name` in the window — would be taken from whichever row is newest,
and for a heavy delegator that is usually a target row: the Driver's bar would read
`invocation-<hex>`. Fix the label to consider only the agent's own rows. This is the only
read-path change in the whole feature. Apply the `/typescript-engineering` skill.

## Implementation plan

1. In `packages/api-server/src/modules/metrics/infrastructure/clickhouse-reader.ts`
   `spendByAgent` (`:135-156`), change the label expression from
   `argMax(ResourceAttributes['platform.agent.name'], Timestamp)` to
   `argMaxIf(ResourceAttributes['platform.agent.name'], Timestamp,
   ResourceAttributes['platform.invocation.id'] = '')` — rows stamped with an invocation
   id are child rows whose name belongs to the target, not to the agent the row is
   attributed to.
2. Update the comment above the query: the group key is unchanged (trusted
   gateway-stamped id, now the root Driver's for Invocation targets); the label reads
   only non-child rows so a Driver is never relabelled by work it delegated.
3. No UI change: `argMaxIf` with no matching rows yields `''`, and
   `packages/ui/src/modules/metrics/components/agent-spend-bars.tsx:8` already falls back
   to the agent id (`row.agentName || row.agentId`) — the pure-dispatcher edge case from
   the README renders the id, which is the accepted residual.

## Acceptance criteria

- [ ] `spendByAgent` groups exactly as before (no change to key, filters, or ordering);
      only the name expression changes.
- [ ] A grouped bucket whose only rows in-window are child rows returns an empty
      `agentName` (client falls back to the id) — never an `invocation-<hex>` name.
- [ ] `mise run api-server:check` passes.

## Smoke test

```
mise run api-server:check
```

Then print a short manual guide: on a cluster with telemetry data (after 01+02 are in),
open Settings → Usage — the Driver's bar keeps the Driver's name even when an Invocation
made the most recent call; alternatively run the `spendByAgent` SQL by hand against
ClickHouse and check the `agentName` column.
