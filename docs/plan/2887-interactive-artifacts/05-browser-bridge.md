# 05 — The browser bridge

**Depends on:** 04-wake-prompt-answer-tool
**Part of:** Interactive Artifacts — see [README](./README.md)

## Context

The half of the feature a person actually touches. The page hands a request to the app, the app
calls the server as the owner, and the app shows what is happening while the turn runs. This is
the security boundary in code: after this slice the page must still have no way to reach the
api-server itself.

## Implementation plan

Apply the `/react-ui-engineering` skill.

1. **Two-way frame.** Extend
   [`deferred-frame.tsx`](../../../packages/ui/src/modules/artifacts/components/deferred-frame.tsx),
   which today only pushes data in. Add an inbound listener that:
   - ignores any message whose `event.source` is not this iframe's `contentWindow`,
   - ignores any message that does not match the pinned `artifact.request` shape,
   - posts replies with a concrete target origin, never `"*"` (the existing `postMessage(postData, "*")`
     is pre-existing and should be tightened in the same pass).
   Keep the frame dumb: it forwards, it does not call tRPC.
2. **The broker.** A hook in `packages/ui/src/modules/artifacts/hooks/` owning the mapping from
   the page's `ref` to a server request id, the mutation, the subscription to settles on the
   existing owner event stream, and the per-artifact "one in flight" state. It is the only place
   that knows both sides.
3. **Waiting states.** The app renders the truth — sent, waking, queued, running — as chrome
   around the page, and also posts each state to the page so a well-made page can draw its own.
   Both, not either. Reuse the existing cold-start signal for "waking" rather than timing it in
   the browser.
4. **Failures.** Render each named reason with its own wording and, where there is one, its next
   step: `over_budget` points at freeing room, `rate_limited` says when it resets,
   `agent_deleted` says the page still works as a document.
5. **Gating.** The interactive surfaces appear only when the `interactive-artifacts` flag is on,
   as the other flagged destinations do.
6. **Where it applies.** The bridge belongs to the artifact preview surfaces —
   `artifact-preview-dialog.tsx` and `docked-artifact-panel.tsx`. The experiments dashboard
   canvas uses the same frame and must keep working unchanged; it pushes data in and never asks.

## Acceptance criteria

- [ ] A request from an interactive page produces an answer rendered in that page, with typed text
      elsewhere in the page preserved.
- [ ] A message from any window other than the artifact's own iframe is ignored.
- [ ] Replies are posted with a concrete target origin.
- [ ] A second request while one is in flight is refused in the app, with wording, not queued.
- [ ] Each failure reason renders its own message.
- [ ] Closing the panel mid-flight abandons the answer without an error, and the turn is not
      cancelled.
- [ ] The experiments dashboard still receives its feed.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run check && mise run test`, then by hand on the dev cluster with the flag on: open an
interactive page in the docked panel, press its button, watch waking → running → answer with the
page updating in place. Press again and confirm the agent remembered. Then open an experiment
dashboard and confirm its live feed is unaffected.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
