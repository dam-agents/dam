# 02 — A Codex turn fails when its model call failed

**Part of:** A failed Pi or Codex model call fails the turn — see [README](./README.md)

## Context

codex-acp writes the final error of a failed Codex turn into the reply as text and ends the turn with `end_turn` (upstream [agentclientprotocol/codex-acp#647](https://github.com/agentclientprotocol/codex-acp/issues/647)), so the web chat gets no card and Slack and Telegram get no reply.
This slice extends the codex-acp patch so that such a turn fails with `Model request failed: <Codex's message>` and writes no reply text.
It covers AC-5; the README section **How codex-acp ends a turn** has the facts.

## Implementation plan

All edits are in `packages/agents/codex/`, `packages/agents/.mise/tasks/check/codex-acp-patch` and two docs.
The patch is plain ESM JavaScript, so `/typescript-engineering` and `/react-ui-engineering` do not apply.

1. **Fail the turn in `createErrorEvent`** in [`codex-acp-patch.mjs`](../../../packages/agents/codex/rootfs/usr/local/share/codex-platform/codex-acp-patch.mjs).
   Add an edit whose `find` is the end of the non-AIR path as the 2.1.1 bundle has it, `count: 1`:

   ```js
       if (error62 === "usageLimitExceeded") {
         this.failure = RequestError.internalError(
           this.createTurnErrorData(params.error)
         );
       }
       return createAgentTextMessageChunk(`${readableServiceErrorMessage(params.error.message)}

   `);
   ```

   The replacement sets `this.failure` to `RequestError.internalError` for every error that reaches it, with `data` holding `createTurnErrorData(params.error)` and `details: "Model request failed: " + readableServiceErrorMessage(params.error.message)`, and returns `null`.
   Only a final error of the current turn reaches these lines: the AIR path, a retried error and another turn's error return earlier.

2. **Name the gap** in `UPSTREAM_GAP`, which the patch prints when it does not apply, and in the message of [`check/codex-acp-patch`](../../../packages/agents/.mise/tasks/check/codex-acp-patch): codex-acp fails a turn whose model request failed, with no reply text (#647).
   Update the patch's `UNIT_BOUNDARY_DESCRIPTION` so it covers both edits, and the first comment of [`harness-chat`](../../../packages/agents/codex/rootfs/usr/local/bin/harness-chat) so it does not name only the title generator.

3. **Update the Codex [README](../../../packages/agents/codex/README.md)**, section **codex-acp patch**: what codex-acp does wrong on a failed turn, the second thing the patch changes, why `details` and no text, and in **To remove it** that a release fixing #647 as proposed still keeps the edit.

4. **Update [provider-status](../../architecture/provider-status.md)**, **The failed turn**: Codex, like Pi, fails the turn with no reply text, so its card shows alone, with Retry.
   **Update [spend-limits](../../architecture/spend-limits.md)**, **Recorded refusal**: no harness ends a refused turn like a normal one any more, so the paragraph keeps only what stays true: the gate counts each refusal in the day's rollup itself, under an unknown model; also check the line on how Codex shows a "bad request" refusal.
   New `Last verified:` dates.

5. Run `mise run //:fix:markdown` and `mise run check:comment-types`.

## Acceptance criteria

- [ ] The patch still applies to codex-acp 2.1.1: `CODEX_ACP=<bundle> mise run //packages/agents:test:codex-acp-patch` passes, and no `codex-acp-patch: not applied` shows.
- [ ] A Codex turn whose model call still fails after Codex's retry answers `session/prompt` with a JSON-RPC error whose `data.details` is `Model request failed: <Codex's message>`, and its reply holds no text.
- [ ] A Codex turn whose model call fails once and then succeeds on Codex's retry ends with `end_turn`, and its reply is the model's text alone.
- [ ] A cancelled Codex turn still ends `cancelled`.
- [ ] The Codex README, `provider-status.md` and `spend-limits.md` describe the new behavior, and nothing in `docs/` says that Codex ends a failed or refused turn normally.
- [ ] `mise run //packages/agents:check` and `mise run //packages/agents:test` pass.

## Smoke test

1. **The patch test against the real bundle:** `npm pack @agentclientprotocol/codex-acp@2.1.1` into the session's scratchpad, then run `CODEX_ACP=<…>/package/dist/index.js mise run //packages/agents:test:codex-acp-patch`.

2. **A throwaway local check, not committed.**
   Install codex-acp 2.1.1 with its dependencies into the scratchpad, so the real Codex runs.
   Start the patched codex-acp as `harness-chat` does, with Codex's provider pointing at a fake Model Router that answers HTTP 503 with a body such as `upstream connect error`.
   Send one prompt and check that `session/prompt` returns a JSON-RPC error with `data.details` starting `Model request failed:`, and that no `agent_message_chunk` holds the error.
   Then make the router fail only the first call: the turn ends `end_turn` with the model's text alone.
   Then cancel a turn whose call hangs: it ends `cancelled`.
   Delete the install afterwards.

3. **On the dev cluster:** step 8 of the README's **Whole-feature smoke test**.

Then print a short manual guide for the user: which Codex agent to use, how to simulate its provider's outage, and what the chat, the Slack thread and the Telegram chat must show.
