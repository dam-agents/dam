# 06 — Delegation block in chat

**Depends on:** 01-design-pass, 03-sdk-contract, 04-read-path, 05-telemetry-per-node
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
   `useInvocationTurns(driverAgentId, ids, enabled)` on `trpc.telemetry.invocationTurns`,
   enabled only when `useFeatures().data?.["agent-telemetry"]` is true, exactly as
   `chat-view.tsx:281-301` gates the per-reply line; poll at the same cadence as
   `useTurns` while any child runs.
4. **Block** — `packages/ui/src/modules/invocations/components/delegation-block.tsx`,
   built on `ActivityBlock` like `ToolChip` is. Collapsed header: count, aggregate status,
   aggregate cost. Body: one `DelegationNodeRow` per node, recursive for `children`, with
   the status dot cascade mirrored from `experiment-dock-panel.tsx:241-290` (waiting for
   room comes from the agents list state `over_budget`, as there), label, duration from
   `createdAt`/`completedAt`, status text. Under each header render `TurnTelemetry`
   from `modules/telemetry/components/turn-telemetry.tsx` with the child's `TurnSummary`
   when one exists; pass the child id so its detail query scopes to the child. A row
   expands to show prompt, result (pretty JSON) and error. The raw script text stays reachable in a collapsed "script"
   section at the bottom so nothing the chip showed is lost. While the tree query has not
   answered, fall back to rendering the ids from the recogniser as pending rows.
5. **Open control** — one button, "Open conversation", on every node. It is present but
   disabled until slice 09 wires the panel; slice 09 enables it for running, waiting and
   captured children.
6. Keep the block free of `formatUsdCents`/`durationSegments` reimplementations: reuse
   `modules/metrics/lib/format.ts`.

## Acceptance criteria

- [ ] A message with a fan-out chip renders the Delegation block instead of the raw chip;
      any other Bash chip renders as before.
- [ ] Rows appear while the children run and refresh to done with results without a page
      reload; the refresh stops once all are terminal.
- [ ] A grandchild is nested under its parent row.
- [ ] With `agent-telemetry` on, each child shows the same telemetry line a reply shows,
      and its chevron opens the child's waterfall; with the feature off nothing renders.
- [ ] Reloading the page and reopening the session restores the block with the same data.
- [ ] Every node shows the disabled "Open conversation" control until slice 09.
- [ ] `mise run check` and `mise run test` pass (including the recogniser test).

## Smoke test

`mise run test` and `mise run check`. With the UI dev server (`localhost:5173`) pointed at
the dev cluster, run the README prompt on the driver and walk README steps 2 to 5. Also send
a plain `ls` to confirm an ordinary Bash chip is untouched.
