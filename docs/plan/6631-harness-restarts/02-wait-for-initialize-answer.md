# 02 — The runtime waits for a new harness process to answer `initialize`

**Part of:** Harness restarts lose Pi spend and break Bob and Codex sessions — see [README](./README.md)

## Context

agent-runtime forwards the first `initialize` of a new harness process and writes the next frame right behind it.
Bob refuses every request except `initialize` until it has written its `initialize` answer, so the first `session/new` or `session/load` after each Bob start fails with `ACP connection must be initialized before '…'`.
This slice makes agent-runtime hold every other frame to a harness process while that process's first `initialize` is unanswered, and send the held frames in order when the answer arrives.
The rule holds for every harness; Bob is the one that fails without it.

## Implementation plan

Apply `/typescript-engineering`.
All code is in [`packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts`](../../../packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts) unless named otherwise.

1. Read how the first `initialize` flows today:
   - `handleClientMessage`: an `initialize` with `initializeAnswer !== null` is answered from the cache; one with `initializeWaiters !== null` waits for the answer; the first sets `initializeWaiters = []` and is forwarded like any request.
   - The harness answer is recognized where the outbound mapping's method is `"initialize"`: it records `sessionCloseSupported`, `sessionResumeSupported`, `sessionForkSupported` and `harnessSteers`, answers the waiters, sets `initializeWaiters = null`, and caches `initializeAnswer` when it has a `result`.
   - Every write to the harness goes through `sendToHarness(frame)`, which calls `lease.send(...)` (in [`harness-lease.ts`](../../../packages/agent-runtime/src/modules/acp/services/acp-runtime/harness-lease.ts)); `lease.send` writes to the child's stdin at once.
   - `teardown(reason)` clears `initializeAnswer` and `initializeWaiters`, so each new process gets a fresh first `initialize`.
   - The lease router delivers a swallowed `initialize` on each client channel it attaches (`channelOn` in [`lease-router.ts`](../../../packages/agent-runtime/src/modules/acp/services/lease-router.ts)), and the client's own frame follows at once.
2. Add a hold to `sendToHarness`:
   - Keep the state that says "the first `initialize` of this process is sent and not answered yet".
     Set it right after that `initialize` is written, not where `initializeWaiters = []` is set, so the `initialize` itself is not held.
   - While that state is set, push every other frame to a held list in order and return as if it was sent; the outbound mapping is already recorded by then, so the answer finds its client.
   - When the `initialize` answer arrives, with a `result` or an `error`, clear the state and send the held frames in order, before the next new frame.
   - On `teardown`, drop the held frames.
     Check that each held request is then answered with the teardown's cause, as the requests the harness never answered are today (`unansweredCalls`, `ownRequests`); add the held ones to that path if they are not covered.
   - A process to which no `initialize` was sent holds nothing.
3. Check the frames the runtime sends of its own accord (for example the `session/close` of an idle reap, `harnessState` requests, cold loads from `session-bootstrap.ts`): they all go through `sendToHarness` and wait the same way.
4. Run the existing runtime suites.
   Tests that expect a frame on the fake harness's stdin right after an unanswered `initialize` change what they assert, or answer `initialize` first; change only those, and add no test file.
5. Add one sentence to [Sessions → Session inside the machine](../../architecture/sessions.md#session-inside-the-machine), next to "Any other lease starts on the first frame naming a session on its harness": a new harness process gets no other frame until it has answered its first `initialize`, since a harness may refuse requests until then.

## Acceptance criteria

- [ ] The first `session/new` after Bob's process starts is not refused with "ACP connection must be initialized".
- [ ] The first `session/load` after a kill of `bob.js acp`, and after an env restart, is not refused that way.
- [ ] A frame never reaches a harness process before that process answered its first `initialize`, and held frames reach it in the order they were sent.
- [ ] Held requests of a process that goes down before it answers are answered with an error, not left without an answer.
- [ ] Claude Code, Codex and Pi start and run a first turn as before.
- [ ] `mise run //packages/agent-runtime:test` and `mise run //packages/agent-runtime:check` pass.

## Smoke test

1. `mise run //packages/agent-runtime:test` and `mise run //packages/agent-runtime:check`: both pass.
2. Install this branch on a dev cluster (`cluster-ops` skill) with an agent that carries Bob.
   Run step 2 of the README's whole-feature smoke test: after the agent's first boot (or a wake), after a kill of `bob.js acp`, and after an env restart, send `session/new` or `session/load` at once.
   No answer says "ACP connection must be initialized".
3. On the same agent, run one normal turn each on Claude Code, Codex and Pi.

Then print a short guide for the user to repeat step 2 by hand.
