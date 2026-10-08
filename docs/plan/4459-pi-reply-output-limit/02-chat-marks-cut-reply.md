# 02 — The chat marks a reply cut at the output limit

**Depends on:** 01-pi-keeps-cut-reply (only for the Pi smoke test; the code stands alone)
**Part of:** Pi agents keep a reply that hits the output limit — see [README](./README.md)

## Context

The chat shows a cut reply as if it were complete. The stop reason already reaches the UI in two
places: `platform/turnEnded.stopReason` while the runtime's session log is live (any harness that
reports `max_tokens`, so Claude Code today and Pi after 01), and, after 01, the replay stamp
`_meta.platform.stopReason` on a reopened Pi chat. This slice adds `stopReason` to the frame
metadata contract, marks the reply from either source, and draws a muted line under it. It follows
the path main already uses for a reply's `model` (commit 9009e6fb0).

## Implementation plan

Apply `/react-ui-engineering` to `packages/ui` and `/typescript-engineering` to the contract.

1. **Contract**,
   [`packages/api-server-api/src/modules/acp/types.ts`](../../../packages/api-server-api/src/modules/acp/types.ts):
   add `stopReason: z.string().min(1).optional()` to `platformFrameMetaSchema`.
   `platformTurnEndedParamsSchema` already has it.

2. **Frame metadata in the UI**:
   - [`modules/acp/types.ts`](../../../packages/ui/src/modules/acp/types.ts): `FrameMeta` gets
     `stopReason?: string`.
   - [`modules/acp/ext-notifications.ts`](../../../packages/ui/src/modules/acp/ext-notifications.ts):
     `frameMetaOf` reads `stopReason` the same way it reads `model`.

3. **`applyUpdate` takes the frame metadata as one object.** It now takes `at`,
   `telemetryPromptId` and `model` as separate optional arguments, and the replay collector copies
   each one field by field. `stopReason` would be the fourth. Change it to
   `applyUpdate(messages, update, frame?: FrameMeta)` (touch it, migrate it):
   - [`modules/acp/session-projection.ts`](../../../packages/ui/src/modules/acp/session-projection.ts):
     the new signature; the per-field stamps (`stampActiveReply`, `stampActiveReplyModel`) read
     from `frame`.
   - Call sites:
     [`use-acp-update-handler.ts`](../../../packages/ui/src/modules/sessions/hooks/use-acp-update-handler.ts),
     [`use-acp-connection.ts`](../../../packages/ui/src/modules/sessions/hooks/use-acp-connection.ts)
     (`CollectedUpdate` keeps `frame: FrameMeta` instead of copied fields),
     [`frames-to-messages.ts`](../../../packages/ui/src/modules/invocations/lib/frames-to-messages.ts).
   - Existing unit tests that pass these arguments positionally (for example in
     `src/__tests__/unit/session-projection.test.ts`) change to the object form. No new tests.

4. **Mark the cut reply.** `Message` in
   [`packages/ui/src/types.ts`](../../../packages/ui/src/types.ts) gets
   `stoppedAtOutputLimit?: boolean`. In `session-projection.ts`, name the ACP value once (a
   constant for `"max_tokens"`), then set the flag on the active reply in two cases:
   - `platform_turn_ended` with `stopReason` `max_tokens`, in `closeActiveAssistant`, only when
     the reply has agent content (as for `interruption`). `closeActiveAssistant` already takes
     four optional positional arguments. Give it one options object rather than a fifth.
   - Any update whose frame carries `stopReason: "max_tokens"` (the replay stamp), stamped on the
     active reply the way `model` is.
   - Check that the flag survives `settleReplay`, `finalizeAllStreaming` and `dropSuperseded`.
     They spread messages, so it should.
   - The tab that sent the prompt also sets the flag from its own prompt response, in
     `use-acp-prompt.ts`'s `finalizeBubble`. The runtime sends that response before
     `platform/turnEnded`, so the sending tab has already closed the reply when the notification
     arrives, and `closeActiveAssistant` finds no active reply (found during implementation).

5. **Draw the line**,
   [`modules/sessions/components/chat-message.tsx`](../../../packages/ui/src/modules/sessions/components/chat-message.tsx):
   under an assistant reply with `stoppedAtOutputLimit` that is not streaming, show
   "Reply stopped at the output limit." Use the look of the quiet "Response interrupted" line in
   [`send-error-card.tsx`](../../../packages/ui/src/modules/sessions/components/send-error-card.tsx)
   (12 px `Warning` icon, `text-xs text-muted-foreground`, `max-w-[620px]`). Extract that markup
   into one small component that both use, so the two notices cannot drift apart. Show it whether
   or not the reply is the last one. Give it `data-testid="reply-output-limit-notice"`.
   `ChatMessage` is memoised on `message`, so the new flag re-renders it.

6. **No architecture doc change.** agent-lifecycle is at its 40,000-character cap, and its
   session-log paragraph already says that a replayed entry carries only what its source supplied
   (decided during implementation).

## Acceptance criteria

- [ ] A reply whose turn ends with `max_tokens` shows "Reply stopped at the output limit." under
      it; a reply that ends with `end_turn` does not.
- [ ] The line stays after a page reload, and shows in a second tab on the same chat.
- [ ] With 01's Pi image, the line is still there after the chat is closed for more than 3 s and
      reopened, and after the agent pod restarts.
- [ ] The line does not show while the reply is still streaming.
- [ ] The "Response interrupted" notice looks and behaves as before.
- [ ] The reply's model label (main's `showModel`) and the times still show.
- [ ] `mise run //packages/ui:check`, `mise run //packages/ui:test`, `mise run //docs:check`,
      `mise run check:comment-types` and `mise run check` pass.

## Smoke test

1. Rebuild and load the UI and the Pi agent image: `mise run cluster:build -- ui agents`. If the
   page still shows the old bundle, see the cluster-ops skill (service worker, cached
   `index.html`).
2. In a Pi agent on IBM LiteLLM with `aws/claude-sonnet-4-6`, ask: "Without tools, write a
   detailed 7000-word design document for a URL shortener, in this one reply." When it stops
   (about 2 minutes), the muted line "Reply stopped at the output limit." shows under it.
3. Send "Say hi." The short reply has no line.
4. Reload the page: the line is still under the document. Open the same chat in a second tab:
   the line is there too.
5. Open another chat, wait 5 s, and come back: the line is still there (rebuilt from the replay
   stamp).
6. Delete the agent pod, wait for it to come back, and reopen the chat: the document and the line
   are there.

Print a short version of these steps for the user so they can confirm by hand.
