# 03 — Delegation card for tool spawns

**Depends on:** 01-sub-agent-tools
**Part of:** Spawn a sub-agent through a tool call — see [README](./README.md)

## Context

#3425 renders a Delegation block in place of the tool chip whose output names a child
(`[invoke] spawned <label> -> <id>` lines). `spawn_subagent`'s result carries that line
(01), so its chip should become the child's card with no parsing change. The
`await_subagents` chips that follow repeat what the card already shows, so they render
compact instead of as raw JSON.

## Implementation plan

Apply `/react-ui-engineering`.

1. **Confirm the anchor.** `packages/ui/src/modules/invocations/lib/fan-out.ts`
   (`parseFanOut`, `fanOutOwners`) scans every tool chip's text content. Check against a
   real `spawn_subagent` chip from the local cluster that the line lands in
   `chip.content[].text` as one line the regex matches (the MCP result text may be wrapped
   or JSON-escaped by the harness). If it does not match, adjust the tool's result text in
   01's `sub-agent-tools.ts` rather than widening the regex.
2. **Recognise `await_subagents` chips.** Find how a chip exposes its tool name in
   `packages/ui/src/types.ts` (`ToolChip`) and how Claude Code names MCP tools there
   (`mcp__<server>__await_subagents`; the server name is `PLATFORM_OUTBOUND_MCP_SERVER`).
   Add a matcher in `modules/invocations/lib/` that accepts the tool by its bare name
   regardless of prefix.
3. **Compact rendering.** In
   `packages/ui/src/modules/sessions/components/chat-message-part.tsx` (`ToolPart`),
   render a recognised await chip as one line: "Waited on 4 sub-agents — 2 done, 1 failed,
   1 running" from the tool's JSON result, with the raw output behind the existing
   disclosure. While the call is in flight: "Waiting on N sub-agents…". Use the existing
   `ActivityBlock` / `ToolChip` pieces; put the component under
   `modules/invocations/components/`. Carbon icons only.

## Acceptance criteria

- [ ] A `spawn_subagent` chip renders as the child's Delegation card, live and after reload.
- [ ] A fan-out of several `spawn_subagent` calls shows one card per child.
- [ ] An `await_subagents` chip shows the one-line summary; the raw output is still
      reachable.
- [ ] Bash-chip delegations from scripts render as before.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run //packages/ui:check` and the existing UI unit tests. Then with the Vite dev
server against the local cluster: run the whole-feature step 1 from the README and check
the chat shows a Delegation card on the spawn chip and a compact await line; reload the
page and check both again. Run a `spawn-subagent` script spawn and check its Bash chip still
becomes a card.
