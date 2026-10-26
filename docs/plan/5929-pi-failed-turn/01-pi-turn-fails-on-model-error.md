# 01 — A Pi turn fails when its last model call failed

**Part of:** A failed Pi model call fails the turn — see [README](./README.md)

## Context

pi-acp ends a Pi turn whose model request failed as a normal `end_turn`, so the web chat gets no card and Slack and Telegram get no reply.
This slice extends the pi-acp patch so that such a turn fails with `Model request failed: <Pi's error>`, drops pi-acp's retry lines from the reply, and retires the `reportProviderErrors` workaround that wrote the error as reply text.
It covers AC-1 to AC-4; the README explains why the rest of the platform needs no change.

## Implementation plan

All edits are in `packages/agents/pi-agent/` and two docs.
The patch is plain ESM JavaScript; `pi-dynamic-providers` is a TypeScript Pi extension.
No server-side or UI TypeScript changes, so `/typescript-engineering` and `/react-ui-engineering` do not apply unless the slice turns out to need such a change; stop and ask before you make one.

1. **Keep the error with the stop reason** in [`pi-acp-patch.mjs`](../../../packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/pi-acp-patch.mjs).
   Today `recordStopReason(session, ev.message?.stopReason)` runs at `turn_end`, and `startTurn` clears it with `undefined`.
   Record both `stopReason` and `errorMessage` of `ev.message` (for example a `recordEnding(session, message)` that stores `{ stopReason, errorMessage }` in the WeakMap).
   Update `turnStopReason`, the `turn_end` edit, the `startTurn` edit and the `globalThis[Symbol.for("platform.pi-acp-patch")]` helper table to match.

2. **Fail the turn in `settleTurn`.**
   Extend the existing `settleTurn` edit, whose `find` is today only the `const reason = …` line, to cover the next line too:

   ```js
       const reason = this.cancelRequested ? "cancelled" : "end_turn";
       this.pendingTurn?.resolve(reason);
   ```

   Replace both lines with one helper call (for example `${HELPERS}.endTurn(this);`), keeping `count: 1`.
   The helper:
   - resolves `"cancelled"` when `session.cancelRequested` is set;
   - rejects `session.pendingTurn` with an `Error` whose message is `Model request failed: <errorMessage>` when the last recorded `stopReason` is `error`; with no `errorMessage`, the message is `Model request failed.`;
   - otherwise resolves with `turnStopReason(session)` (`max_tokens` or `end_turn`), as today.

   Keep the prefix: the ACP library reads a thrown message as JSON when it can, and the chat's outage pattern needs `failed: 503` when the provider's text has no `HTTP 503` (README, **How pi-acp ends a turn**).
   The rest of `settleTurn` (clear `pendingTurn`, start the next queued turn) stays as it is.

3. **Drop the retry lines.**
   Add an edit that removes pi-acp's `auto_retry_start` and `auto_retry_end` cases from `handlePiEvent`, so those events fall through to `default`.
   The `find` is the two whole cases as the 0.0.34 bundle has them, `count: 1`, `replace: ""`:

   ```js
         case "auto_retry_start": {
           this.emit({
             sessionUpdate: "agent_message_chunk",
             content: { type: "text", text: formatAutoRetryMessage(ev) }
           });
           break;
         }
         case "auto_retry_end": {
           this.emit({
             sessionUpdate: "agent_message_chunk",
             content: { type: "text", text: "Retry finished, resuming." }
           });
           break;
         }
   ```

   Leave the compaction notices (`auto_compaction_start`, `auto_compaction_end`) alone.

4. **Name the new upstream gaps** in `UPSTREAM_GAPS`, which the patch prints when it does not apply: pi-acp fails a turn whose model request failed (https://github.com/svkozak/pi-acp/issues/135), and writes no retry notice into the reply.

5. **Retire the workaround.**
   - In [`pi-dynamic-providers/index.ts`](../../../packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/extensions/pi-dynamic-providers/index.ts), delete `reportProviderErrors` and its call at the top of `register`.
   - In [`harness-chat`](../../../packages/agents/pi-agent/rootfs/usr/local/bin/harness-chat), delete the `PI_PLATFORM_REPORT_ERRORS=1` line, and make its first comment name the pi-acp issues the patch now covers, or point to the README without a list.
   - `git grep PI_PLATFORM_REPORT_ERRORS` and `git grep "Model request failed"` find nothing else outside the patch and the docs.

6. **Update the pi-agent [README](../../../packages/agents/pi-agent/README.md).**
   - **Provider errors in the chat:** rewrite it: pi-acp ends a failed turn as a clean `end_turn` (#135); the patch fails it with `Model request failed: <error>` after Pi's own retries, so the chat shows its failed-message card and Slack and Telegram their failure reply; why the prefix; why the retry lines go (the card's Retry needs a reply with no text; the status line covers an outage).
     Drop the sentences about the extension notification and `PI_PLATFORM_REPORT_ERRORS`.
   - **pi-acp patch:** add the failed turn and the retry lines to the description of what pi-acp does wrong, and two bullets to the list ("eight things" becomes ten).
     In **To remove it**, add #135; say that a release that fixes #135 but still writes retry lines keeps the retry edit, and update "some of the four".

7. **Update [provider-status](../../../docs/architecture/provider-status.md)** and its `Last verified:` date.
   - **The failed turn:** the sentence that starts "Pi ends such a turn like a normal one" is no longer true.
     Replace it: Pi writes nothing into the reply while it retries and fails the turn with its error, so its card shows alone, with Retry.
   - **The status line:** drop "it shows on Pi too, which ends a failed turn with no error"; the line shows before a turn fails on every harness.

8. Run `mise run //:fix:markdown` and `mise run check:comment-types`.

## Acceptance criteria

- [ ] The patch still applies to pi-acp 0.0.34: the machine log of a Pi agent, and the stderr of the Pi image tests, show no `pi-acp-patch: not applied`.
- [ ] A Pi turn whose last model call fails after Pi's retries answers `session/prompt` with a JSON-RPC error whose `data.details` is `Model request failed: <Pi's error>`.
- [ ] A Pi turn whose model call fails once and then succeeds on Pi's retry ends with `end_turn`, and its reply holds no `Retrying` or `Retry finished` text.
- [ ] A cancelled turn still ends `cancelled`, and a reply cut at the output limit still ends `max_tokens`.
- [ ] `reportProviderErrors` and `PI_PLATFORM_REPORT_ERRORS` no longer exist in the repository.
- [ ] The pi-agent README and `provider-status.md` describe the new behavior, and nothing in `docs/` says that Pi ends a failed turn normally.
- [ ] `mise run //packages/agents:check` and `mise run //packages/agents:test` pass.

## Smoke test

1. **Existing checks.**
   Run `mise run //packages/agents:check:pi-acp-patch`, then `mise run //packages/agents:test:pi-session-ref`, `//packages/agents:test:pi-router-switch` and `//packages/agents:test:pi-provider-selection`.
   They run the real Pi through the patched pi-acp against a fake Model Router, and `pi-session-ref` fails when an edit does not match the bundle.

2. **A throwaway local check, not committed.**
   Copy `packages/agents/.mise/tasks/test/pi-session-ref` into the session's scratchpad and change its fake router so the chat call answers HTTP 503 with a body such as `upstream connect error`.
   Send one prompt and check that `session/prompt` returns a JSON-RPC error with `data.details` starting `Model request failed: 503`, after about 14 seconds, and that no `agent_message_chunk` holds `Retrying`.
   Then make the router fail only the first call and answer the second: the turn ends `end_turn`, and the reply is the model's text alone.
   Delete the copy afterwards.

3. **On the dev cluster:** walk the README's **Whole-feature smoke test**, which covers AC-1 to AC-4, Retry and a reload.
   Take the screenshot of the AC-1 card for the PR, because the change alters what the web chat shows.

Then print a short manual guide for the user: how to simulate the outage, which agent to use, and what the chat, the Slack thread and the Telegram chat must show.
