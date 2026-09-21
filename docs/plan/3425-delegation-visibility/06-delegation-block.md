# 06 — Delegation block in chat

**Depends on:** 01-design-pass, 03-sdk-contract, 04-read-path, 05-cost-per-node
**Part of:** Delegation visibility — see [README](./README.md)

## Context

The driver's Bash tool chip is the only trace of a fan-out in chat, and it renders as raw
text. This slice recognises that chip, fetches the delegations behind it, and renders the
Delegation block the design pass agreed: rows per child with status, cost and result,
nested for grandchildren, refreshed while any child runs, restored on replay because the
chip content is in the driver's history. Opening a child is slice 09; here the open control
exists and is disabled for a finished child.

Apply `/react-ui-engineering`. Follow the README `## Design` section.

## Implementation plan

1. **Recogniser** — `packages/ui/src/modules/invocations/lib/fan-out.ts`, a pure function
   `parseFanOut(chip: ToolChip): { id: string; label: string }[] | null` applying the README
   regex line by line over `chip.content[].text`, de-duplicated by id. Unit-test worthy: it
   is the one piece of parsing the feature rests on and has no manual smoke path of its own
   (the exception the plan skill allows).
2. **Dispatch** — `packages/ui/src/modules/sessions/components/chat-message-part.tsx:62`:
   for `part.kind === "tool"`, when `parseFanOut(part)` yields ids render
   `<DelegationBlock chip={part} spawns={…} />`, else the existing `ToolChip`. The block
   needs the driver id: read `selectedAgent` from the store in the block, not in
   `ChatMessage`, which stays props-only.
3. **Queries** — `packages/ui/src/modules/invocations/api/queries.ts`:
   `useDelegationTree(driverAgentId, ids)` on `trpc.invocations.tree.queryOptions`, with
   `refetchInterval` of 5 s while any returned node is `running` and off otherwise;
   `useInvocationSpend(driverAgentId, ids, enabled)` on `trpc.metrics.invocationSpend`,
   with the same `isMetricsUnavailable` guard `modules/metrics/api/queries.ts` uses so a
   missing telemetry backend disables it permanently and hides the column.
4. **Block** — `packages/ui/src/modules/invocations/components/delegation-block.tsx`,
   built on `ActivityBlock` like `ToolChip` is. Collapsed header: count, aggregate status,
   aggregate cost. Body: one `DelegationNodeRow` per node, recursive for `children`, with
   the status dot cascade mirrored from `experiment-dock-panel.tsx:241-290` (waiting for
   room comes from the agents list state `over_budget`, as there), label, duration from
   `createdAt`/`completedAt`, cost, status text. A row expands to show prompt, result
   (pretty JSON) and error. The raw script text stays reachable in a collapsed "script"
   section at the bottom so nothing the chip showed is lost. While the tree query has not
   answered, fall back to rendering the ids from the recogniser as pending rows.
5. **Open control** — a running node's control calls `selectAgent(id)` (the child Agent
   exists; this is what the experiments dock does). A finished node's control is present but
   disabled until slice 09 wires it.
6. Keep the block free of `formatUsdCents`/`durationSegments` reimplementations: reuse
   `modules/metrics/lib/format.ts`.

## Acceptance criteria

- [ ] A message with a fan-out chip renders the Delegation block instead of the raw chip;
      any other Bash chip renders as before.
- [ ] Rows appear while the children run and refresh to done with results without a page
      reload; the refresh stops once all are terminal.
- [ ] A grandchild is nested under its parent row.
- [ ] Cost shows once telemetry has rows; the column is absent when metrics are unavailable.
- [ ] Reloading the page and reopening the session restores the block with the same data.
- [ ] A running node opens the child's chat; a finished node's open control is disabled.
- [ ] `mise run check` and `mise run test` pass (including the recogniser test).

## Smoke test

`mise run test` and `mise run check`. With the UI dev server (`localhost:5173`) pointed at
the dev cluster, run the README prompt on the driver and walk README steps 2 to 5. Also send
a plain `ls` to confirm an ordinary Bash chip is untouched.
