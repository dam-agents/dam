# 01 — The runtime keeps a follow-up chat's copy

**Part of:** A finished sub-agent cannot be asked follow-up questions — see [README](./README.md)

## Context

The runtime accepts `continuedFrom` on `session/new`, keeps it in session metadata, sends it to the harness once in a hidden block before the first typed text, returns it on every load, and lets rewind and fork match the first message without the block.
Nothing in the UI sends it yet; without the field every path behaves as today.

## Implementation plan

Apply `/typescript-engineering`.
Paths are under `packages/agent-runtime/src/modules/acp/`.

1. **Schema.** In `infrastructure/session-metadata-store.ts`, add `continuedFrom` (the README contract) to `platformSessionMetaSchema`, plus a `continuedFromSent` boolean on the same entry.
   Bound the strings (for example 64 KiB each for `prompt` and `result`, 200 chars for `label`); refuse a larger value at `session/new` rather than cut it silently.
2. **Accept.** `extractPlatformMeta` (`services/acp-runtime/acp-runtime.ts`, around :2224) already parses `_meta.platform` on `session/new`; check that `continuedFrom` passes through it and lands in the stored meta (around :1546).
3. **Inject once.** In `promptFrameFor` (`acp-runtime.ts` :927), when the session's meta has `continuedFrom` and `continuedFromSent` is not set, prepend one text block built by a pure helper in `domain/` (beside `direct-turn.ts`), for example `frameContinuedFrom(prompt, continuedFrom)`.
   Keep `frameDirectTurn` composable with it.
   - Mark `continuedFromSent` when the harness answers that turn (the `onPromptResponse` path where `turnEnded` is true), not when the frame is built, so a turn the harness never took sends the block again.
   - The echo (`appendUserPromptToLog`, via `onTurnStarted`) and the title (around :2037) keep using the typed text only.
     Check that they do.
   - `undeliveredOf(echoId, frame)` records the framed frame.
     Record the frame without the `<continued-from>` block, so a resend gets the block once, from step 3.
4. **Return on load.** In `services/acp-runtime/session-bootstrap.ts`, `withReplayMeta` (:125) adds `runStarts` to every load, provider-served loads included (:205-211).
   Add `continuedFrom` the same way, read from session metadata, on `load` (not on `resume`).
5. **Rewind and fork.** In `domain/rewrite-cut.ts`, compare user texts with the `<continued-from>…</continued-from>` block removed (in `textOf` or in the matcher at :87-89).
   When the cut is at the first message, the rewound or forked copy gets the original's `continuedFrom` and a cleared `continuedFromSent`, so its first prompt carries the block again; find where `rewriteFrom` (`acp-runtime.ts` :1065-1160) copies meta (`adopt`, `set`) and add it there.
6. **Docs.** In `docs/architecture/sessions.md`, describe the follow-up chat: the copy kept in session metadata, sent once to the harness in a hidden block, returned on every load, and kept by rewind and fork.
   Update `Last verified:`.

## Acceptance criteria

- [ ] A `session/new` with `_meta.platform.continuedFrom` stores it; a later `session/load` response carries it in `_meta.platform.continuedFrom`, also after a session-history provider refilled the log.
- [ ] The first prompt the harness receives starts with the `<continued-from>` block followed by the typed text; the second prompt has no block.
- [ ] The echoed user frame and the session title use the typed text only.
- [ ] A first prompt that was undelivered and then resent reaches the harness with exactly one block.
- [ ] Rewind and fork from the first message of a follow-up chat succeed, and the copy keeps `continuedFrom`.
- [ ] A session without `continuedFrom` behaves exactly as before.
- [ ] `mise run //packages/agent-runtime:test` and `mise run //packages/agent-runtime:check` pass.

## Smoke test

1. `mise run //packages/agent-runtime:test` and `mise run //packages/agent-runtime:check`.
2. On the local cluster, rebuild the agents (`mise run cluster:build -- agents`) and, with a small WebSocket script against an agent's ACP endpoint (the same path the UI uses), send `session/new` with a `continuedFrom`, then a prompt "What was the result?".
   The reply quotes the result; the echoed user frame shows only "What was the result?".
3. Send `session/load` for that session: the response `_meta.platform.continuedFrom` matches what was sent.

Print a short manual guide for the user with steps 2 and 3.
