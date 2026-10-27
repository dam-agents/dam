# 02 — Pi steers, and Codex starts no hidden turn

**Depends on:** 01-clients-see-whether-a-session-steers
**Part of:** Mid-turn messages reach the agent on every harness — see [README](./README.md)

## Context

Pi 1.3.0 can take a message mid-turn with its `steer` RPC: Pi delivers the message after the current tool calls and before the next model call.
The bridge that the platform runs, pi-acp 0.0.34, does not expose it.
Upstream PR svkozak/pi-acp#115 adds `_session/steering`, but it is not released, and it has a gap: Pi queues a steer even when its run has already ended, so the message waits for some later prompt or is lost when Pi exits.
The platform already edits pi-acp's bundle in memory with [`pi-acp-patch.mjs`](../../../packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/pi-acp-patch.mjs); this slice adds the steering edits there, with an answer that waits until Pi takes the message.
Codex steers natively, but when no turn runs, codex-acp 2.1.1 starts a turn of its own from a steer and ignores `idleBehavior: "promptRequired"`.
The runtime then queues the same message again, so the agent gets it two times; in Slack that can mean two replies.
One edit in [`codex-acp-patch.mjs`](../../../packages/agents/codex/rootfs/usr/local/share/codex-platform/codex-acp-patch.mjs) stops this.
This slice comes before 04, so that channel steering never reaches a Codex without the fix.

## Implementation plan

Read each patch file first: an edit is a `{ find, replace, count }` string replacement on the loaded bundle, and helpers live on a global symbol.
Read the pinned bundles in the image build cache to place each `find` exactly (`mise run cluster:shell -- …`, under `~/.cache/platform-agent-oci/harness-tools/current/usr/share/mise/installs/`).
In pi-acp, read `dist/index.js`; in Pi, read `dist/modes/rpc/rpc-mode.js` and `dist/core/agent-session.js`.

### Pi

1. **Advertise steering.**
   In `PiAcpAgent`'s `async initialize(params)`, add `_meta: { steering: { supported: true } }` to the returned object; it has no other top-level `_meta`.
   Add `steering: native` to [`packages/agents/pi-agent/rootfs/app/runtime-manifest.yaml`](../../../packages/agents/pi-agent/rootfs/app/runtime-manifest.yaml), with a comment that the steering comes from the patch.
   In `test:harness-initialize-capabilities`, start Pi through the same patch loader as `harness-chat`, so that the drift check of 01 sees the patched answer.

2. **Serve `_session/steering`.**
   The ACP SDK that pi-acp imports (`@agentclientprotocol/sdk` 0.26.0) sends any unknown request method to `agent.extMethod`.
   Add `async extMethod(method, params)` to `PiAcpAgent` (`var PiAcpAgent = class {` in the bundle), and keep the logic in a helper.
   Pass the helper what it cannot import: the bundle's `RequestError` class (the SDK maps only its own class to a JSON-RPC code) and `promptToPiMessage`.
   - For any other method, throw `RequestError.methodNotFound(method)`.
   - Find the session with `this.sessions.maybeGet(sessionId)`, not `restoreSession`, which would start a Pi process.
     No session, or no pending turn: answer `{ outcome: "promptRequired", reason: "noRunningTurn" }`.
   - A prompt with image blocks: answer `promptRequired`, because Pi's steer path does not resize images; the message then starts the next turn.
   - Otherwise send Pi the RPC `{ type: "steer", message, images }`.

3. **Answer only when Pi takes the message.**
   Do not answer `injected` when the RPC returns, because Pi queues a steer even after its run ended.
   - Hold the answer until Pi emits `message_start` for a user message with the same text, the same match that Pi uses itself; then answer `{ outcome: "injected" }`.
   - When the turn settles (`agent_settled`), is cancelled, or Pi exits while the message is still queued, call Pi's `clear_queue` RPC and answer `promptRequired`.
     The runtime then queues the message again at the head.
     At a steer point Pi's next model call starts at once, so the wait is short.
     Pi delivers one queued steer per model call (`steeringMode: "one-at-a-time"`), and the runtime sends one batch per steer, so this holds.

4. **Upstream note and README.**
   Add the steering gap to `UPSTREAM_GAPS`, and update the matching text in [`check/pi-acp-patch`](../../../packages/agents/.mise/tasks/check/pi-acp-patch).
   In [`packages/agents/pi-agent/README.md`](../../../packages/agents/pi-agent/README.md) "pi-acp patch", list the steering edits.
   Say that they go away only when a pi-acp release serves `_session/steering` and also handles a steer that reaches Pi after its last queue check; #115 alone does not.

### Codex

5. **No hidden turn.**
   In codex-acp 2.1.1, `performSteeringRequest` ends with `    return await this.startNewTurnFromSteering(params);` (four spaces), which occurs once.
   Replace it with `    return { outcome: "promptRequired", reason: "noRunningTurn" };`.
   Only the runtime and the api-server send `_session/steering`, and both ask for `promptRequired`, so the edit needs no condition.
   Goal continuation is the only other path that starts a turn without a prompt, and a steer never reaches it.
   Add the gap to `UPSTREAM_GAPS`, update [`check/codex-acp-patch`](../../../packages/agents/.mise/tasks/check/codex-acp-patch) to match, and note the edit in [`packages/agents/codex/README.md`](../../../packages/agents/codex/README.md).

6. **Checks.**
   Run `mise run //packages/agents:check:pi-acp-patch`, `mise run //packages/agents:check:codex-acp-patch`, `mise run //packages/agents:test:pi-session-ref`, and `mise run //packages/agents:test:codex-acp-patch` with `CODEX_ACP` set to the pinned bundle (the test skips without it).
   Run `mise run //packages/agents:test:harness-initialize-capabilities` with `PI_ACP` and `CODEX_ACP` set.

## Acceptance criteria

- [x] On a Pi agent, the machine log has no `pi-acp-patch: not applied` line, and a Pi session's `session/new` result carries `_meta.platform.steering: "native"`.
- [x] In a Pi chat, a message sent while a command runs joins the running work at the next steer point, and the agent acts on it in that work.
- [x] Driven directly over stdio, pi-acp answers `promptRequired` to a steer on an idle session, and answers `promptRequired` again, after clearing Pi's queue, to a steer that reaches Pi after its run ended.
- [x] On a Codex agent, the machine log has no `codex-acp-patch: not applied` line, and a mid-turn message still steers as before.
- [x] The four checks of step 6 pass.

## Smoke test

1. `mise run cluster:build -- agents`.
2. In the web UI, in a Pi chat, run the README's three-command task, and send "Change of plan: run no more commands, reply only DONE" during the first command.
   Expect the message in the running work and DONE at the end; BRAVO can still show.
3. Repeat step 2 in a Codex chat.
4. Drive pi-acp over stdio with the client in [`packages/agents/test-lib/acp-client.mjs`](../../../packages/agents/test-lib/acp-client.mjs), as `test:pi-session-ref` does: send `_session/steering` to an idle session, and expect `promptRequired`.
5. Check the machine logs of both agents for a `not applied` line from either patch, and expect none.

Then print a short manual guide so that the user can repeat steps 2 and 3 by hand.
