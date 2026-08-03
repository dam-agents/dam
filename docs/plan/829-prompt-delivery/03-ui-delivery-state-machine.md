# 03 — UI: delivery state machine

**Depends on:** 02-runtime-prompt-lifecycle-notifications
**Part of:** Honest prompt delivery feedback — see [README](./README.md)

## Context

Replace the send-anchored watchdog in `use-acp-prompt.ts` with the per-state contract from
the README, driven entirely by the runtime's new notifications. This is the slice that kills
the false "send failed". Apply `/react-ui-engineering`.

## Implementation plan

1. **Stamp the promptId** — `packages/ui/src/modules/sessions/hooks/use-acp-prompt.ts`:
   generate `promptId = crypto.randomUUID()` per send and pass it in the prompt call:
   `conn.prompt({ sessionId, prompt: promptBlocks, _meta: { platform: { promptId } } })`
   (the SDK's `PromptRequest` accepts `_meta` natively). Store `promptId` on the optimistic
   assistant bubble (add `promptId?: string` to `Message` in `packages/ui/src/types.ts`).
2. **Map the notifications** — `packages/ui/src/modules/acp/acp.ts` (~line 119): mirror the
   `platform/turnEnded` extNotification handling for `platform/promptAccepted` and
   `platform/promptStarted`. Validate with the schemas exported from `api-server-api`
   (import path per the existing turnEnded import) and forward them into the same update
   callback as synthetic updates — `sessionUpdate: "platform_prompt_accepted"` /
   `"platform_prompt_started"` carrying `promptId` (and `queued` for accepted), matching
   how `platform/turnEnded` becomes `platform_turn_ended`.
3. **Projection transitions** — `packages/ui/src/modules/acp/session-projection.ts`, new
   `applyUpdate` cases keyed by `promptId`:
   - `platform_prompt_accepted` with `queued: true` → set `queued: true` on the matching
     bubble (this is what renders "Waiting for previous prompt…" — now server truth);
     with `queued: false` → no visual change needed.
   - `platform_prompt_started` → set `queued: false` on the matching bubble (explicit
     promotion). Keep the existing ordering-based promotion for bubbles *without* a
     promptId (other viewers' bubbles created from the logged echo still rely on it).
4. **Rebuild the watchdog as per-state timers** in `use-acp-prompt.ts`:
   - Replace the single `watchdogRef` with a `Map<promptId, timer>` ref plus a
     per-promptId delivery record (e.g. `Map<promptId, "sending" | "queued" | "started">`)
     updated from the notification flow (the hook can expose a handler the orchestrator
     wires to the synthetic updates, alongside the projection).
   - On send: arm the **sending timer** (keep `DELIVERY_TIMEOUT_MS = 60_000`). At fire
     time: if no `promptAccepted` was recorded for that promptId → fail the bubble exactly
     as today (error + `retryWith`; `hidden` sends drop silently).
   - On `promptAccepted`: clear the sending timer. No timer while queued.
   - On `promptStarted`: arm the **content timer** (60s). At fire time: if the bubble still
     streams with zero parts → fail as today. First content arriving makes the fire-time
     check a no-op (same pattern as the current watchdog, correctly anchored).
   - Delete the `startingQueued` / `hasStreamingAssistant` guess at send time — `queued`
     now comes only from the server (`hasStreamingAssistant` stays for projection
     internals). Keep the existing `finally` cleanup, clearing whichever timer for that
     promptId is still pending when `conn.prompt()` settles, and keep the belt-and-braces
     bubble close.
   - Keep the retry-button-dedup behavior (only the latest failure offers Retry) unchanged.
5. **Error path unchanged**: `conn.prompt()` rejections (connection failure, queue-full
   error response) still flow through the existing `catch`.
6. **Stable selectors for e2e** (consumed by sub-issue 05): give the waiting indicator, the
   delivery-failure indicator, and the Retry button `data-testid`s, following the existing
   testid conventions in the chat components (`chat-message` etc.).

## Acceptance criteria

- [ ] A prompt sent while a prior turn runs shows "Waiting for previous prompt…" within
      ~1s (server-acked), survives a prior turn far longer than 60s, and completes normally.
- [ ] The same holds after a mid-turn page reload (the #829 repro) — no reliance on local
      streaming state.
- [ ] A prompt sent to an idle session behaves as today (content streams, no indicator).
- [ ] No `promptAccepted` within 60s of send → the existing failure UI with Retry.
- [ ] `promptStarted` followed by 60s of silence → the existing failure UI with Retry.
- [ ] Hidden sends still fail silently (bubble dropped) at both timers.

## Smoke test

On the local cluster (`cluster-ops` skill): run README smoke steps 1–3 (long turn via
`sleep 90`, queued second prompt, mid-turn reload variant). Then
`mise run ui:check` — green.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
