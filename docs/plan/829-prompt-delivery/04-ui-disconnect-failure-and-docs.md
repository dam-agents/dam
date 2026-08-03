# 04 — UI: fail queued prompts on disconnect + doc update

**Depends on:** 03-ui-delivery-state-machine
**Part of:** Honest prompt delivery feedback — see [README](./README.md)

## Context

The one failure the server cannot signal: the sender's WS closes while a prompt sits queued.
The runtime drops a channel's queued prompts on detach (`acp-runtime.ts`, `detach()`), so
connection loss means the prompt is gone — today this loss is silent. This slice makes it
fail loudly with Retry, and documents the whole delivery lifecycle. Apply
`/react-ui-engineering`.

## Implementation plan

1. **Carry the retry payload on the bubble** — `packages/ui/src/modules/sessions/hooks/use-acp-prompt.ts`
   currently builds `error.retryWith` from closure variables at failure time; the WS-close
   handler has no closure. Store the payload on the optimistic assistant bubble at send
   time (e.g. `retryWith?: { text, attachments }` on `Message`, alongside `promptId` from
   sub-issue 03) and use it from both the timers and the close handler. Hidden sends carry
   none (they always fail silently).
2. **Fail queued bubbles on close** — add a projection helper in
   `packages/ui/src/modules/acp/session-projection.ts`, e.g. `failQueuedOnDisconnect(messages)`:
   bubbles with `queued && streaming` flip to
   `{ streaming: false, queued: false, error: { message, retryWith } }` (drop hidden ones);
   every other streaming bubble finalizes as `finalizeAllStreaming` does today.
   Use it in the WS-close path in
   `packages/ui/src/modules/sessions/hooks/use-acp-connection.ts` (~line 188) in place of
   `finalizeAllStreaming`. Clear any pending delivery timers for the failed promptIds.
3. **Failure state must survive reconnect** — the reconnect path rebuilds messages
   wholesale from the replayed log (`use-acp-connection.ts` ~line 148:
   `setMessages(await loadHistory(sid))`), which would silently wipe a locally-failed
   bubble — and the replayed log is misleading here: it contains the dropped prompt's
   user-message echo but no reply will ever come. Merge locally-failed bubbles
   (`error.retryWith` present) into the rebuilt list instead of discarding them, so after
   reconnection the user still sees the failure and can Retry. Sub-issue 05's disconnect
   spec exercises exactly this seam.
4. **Leave `stopAgent` untouched** — it keeps plain `finalizeAllStreaming`
   (`use-acp-prompt.ts` ~line 214): a user-initiated stop is not a delivery failure.
5. **Document the lifecycle** — add a "Prompt delivery" subsection to the sessions material
   in [`docs/architecture/agent-lifecycle.md`](../../architecture/agent-lifecycle.md):
   the accepted/queued/started lifecycle, the two ephemeral sender-only notifications, the
   per-state failure contract, queue lossiness (drop on detach / recycle / agent exit), and
   the deliberate non-goal (wedged-agent detection deferred). Follow
   [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md)
   (including the `Last verified` stamp). Never reference the ADR.

## Acceptance criteria

- [ ] Killing the connection while a prompt is queued flips its bubble to the failure UI
      with a working Retry; the retried prompt goes through after reconnect.
- [ ] The failure UI survives the reconnect rebuild — after the tab reconnects and history
      replays, the failed bubble with Retry is still there.
- [ ] A normal disconnect with no queued prompt behaves as today (bubbles finalize, no error).
- [ ] Hidden queued prompts disappear silently on disconnect.
- [ ] `docs/architecture/agent-lifecycle.md` describes the delivery lifecycle and passes
      the documentation guidelines (fresh `Last verified`, no volatile content, no ADR refs).

## Smoke test

On the local cluster (`cluster-ops` skill): README smoke step 4 — queue a prompt behind a
long turn, kill the agent pod (or take the network offline in devtools), watch the queued
bubble fail with Retry, reconnect, press Retry, see the prompt deliver. Then
`mise run ui:check` — green.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
