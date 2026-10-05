# 06 — One steering point for every surface

**Depends on:** 03-native-steer
**Part of:** Mid-turn steering and message correction — see [README](./README.md)

## Context

After 03 two places steer: the runtime for the web UI, and the channel queue in the api-server for
Slack/Telegram (each steer opening its own ACP connection and holding the batch in api-server
memory). This slice makes the runtime the one place that decides steer-or-queue for every surface.
The channel queue keeps what is truly channel-specific — the quiet period that coalesces a burst,
the per-conversation keys, the `<new-messages>` frame with `[ts]` reply targets, attachments and
ambient rules — and hands the delivery decision to the runtime. No correction for channels.

## Implementation plan

Apply `/typescript-engineering`.

1. **Contract** — `session/prompt` `_meta.platform.steer = { prompt: PromptBlock[] }` (README): the
   blocks to inject if the runtime steers; the frame's normal `prompt` is used if it starts a turn.
   Channel prompts mint a `promptId` so they get `promptAccepted{ steered }` / `promptStarted`.
2. **Runtime** — scheduler steerability: `surface === "ui"` **or** `_meta.platform.steer` present.
   A steered channel prompt injects the `steer` blocks. Write the steered echo as in 03.
3. **Channel queue** — `conversation-queue.ts`:
   - Replace `runTurn` + `steer` with one submit path: a batch arriving while the conversation's
     turn runs is sent as a `session/prompt` on the turn's session carrying both the turn text and
     the steer frame; the runtime's answer (`steered` or queued→started) replaces
     `SteerResult` handling, `onSteered` fires on `promptAccepted{ steered: true }`.
   - Keep: the settle loop, `canSteer` (attachments; ambient never steers — send no `steer` meta),
     the one-delivery and order rules (now enforced by the runtime; keep the claim until the
     runtime answers so a batch is never sent twice).
   - Remove `acpClient.steer()` and `steeringSupported()` from `packages/api-server/src/core/acp-client.ts`
     once nothing calls them.
4. **Slack/Telegram** — `slack.ts` (`createAddressedQueue`, ambient queue) and `telegram.ts`:
   build the steer frame as today, pass it as `steer` meta; reply-target registration
   (`beginTurn`, `steeredRefs`) stays on `onSteered`.
5. **Docs** — `channel-turns.md` "Inbound": steering is decided by the runtime; the channel queue
   coalesces and frames. `agent-lifecycle.md` "Prompt delivery": channel prompts may steer.

## Acceptance criteria

- [ ] Slack and Telegram mid-turn messages still steer on Claude Code (and pi after 05), with the
      same reply-target behavior; attachments and ambient batches still never steer.
- [ ] A refused steer still becomes the next turn, once, in order.
- [ ] `api-server` no longer opens a separate ACP connection to steer.
- [ ] The existing channel test suites pass unchanged in intent (`mise run //packages/api-server:test`);
      tests that exercised the removed `steer` dep are updated, not deleted without replacement.

## Smoke test

Slack DM to a Claude Code agent: send a slow task, then two quick follow-ups mid-turn; one reply
covers all three. In a channel thread: two people reply in the thread mid-turn; the agent answers
in the thread once. Send a follow-up with a file attachment mid-turn: it becomes the next turn.
