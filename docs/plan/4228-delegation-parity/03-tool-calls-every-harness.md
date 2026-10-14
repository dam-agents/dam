# 03 — Tool spawns and waits work on every harness

**Part of:** Delegation works the same on every harness — see [README](./README.md)

## Context

The live smoke test of 01 and 02 found three gaps in the sub-agent tools themselves, and one in the chat.

- Codex sends the `schema` argument as JSON text, because the tool declares it with no type.
  The server refused every Codex spawn ("schema must be object or boolean").
- Pi's MCP client stops a call after 60 seconds, but `await_subagents` waits up to four minutes.
  Every Pi wait failed, and the agent retried and respawned.
- After a wait returns "still running", its lease on the ids lasted 8 seconds.
  A child that finished while the model thought was pushed as a turn and returned by the next wait too (seen on Bob).
- Codex marks an MCP call as `execute`, so the chat grouped it as "Ran N commands".

## Implementation plan

Apply `/typescript-engineering` to the api-server and `/react-ui-engineering` to the UI.

1. `spawn_subagent` parses a `schema` that arrives as text before it validates the request.
2. `await_subagents` sends an MCP progress message every 20 seconds while it waits, when the call carries a progress token.
   Pi restarts its own timeout on each one; no harness's tool timeout is raised.
3. When a wait returns, the ids still running keep the lease for a minute.
4. The chat counts a chip whose title names an MCP tool (`toolNameOf` strips a server) as a tool, not as a command.
5. The `await_subagents` description and the skill say: a connection error from the call does not stop the sub-agents, so call it again.
   The cause, any agent create or delete cutting open calls through the api-server's waypoint, is a separate issue (see the README).
6. A wait whose HTTP request closed stops and collects nothing, so the sweep delivers its outcome as a turn.
   The MCP transport forgets a dropped stream but never aborts the handler, so the wait also watches the request's own signal; before this, a cut wait went on polling and marked the outcome delivered into a dead connection.
7. `invocations.md`: the progress messages, the lease grace, and the cut by the mesh.

## Acceptance criteria

- [ ] A Codex `spawn_subagent` call with a text schema spawns.
- [ ] On Pi, `await_subagents` on a sub-agent that runs 3 minutes returns its result in the same call.
- [ ] A result that a wait returns is not also pushed as a turn while the agent keeps waiting.
- [ ] Codex chats label MCP calls "Used N tools".
- [ ] A wait cut by the mesh leaves its outcome undelivered, and the sweep pushes it as a turn.
- [ ] `mise run //packages/api-server:check`, `mise run //packages/api-server:test`, `mise run //packages/ui:check`, `mise run //packages/ui:test` and `mise run check:comment-types` pass.

## Smoke test

Part of the whole-feature 4 × 4 run in the README; on Codex and Bob, also wait on a 3-minute child, to see whether their clients restart their timeout on progress.
