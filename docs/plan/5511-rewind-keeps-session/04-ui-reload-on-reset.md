# 04 — The chat reloads on a reset

**Depends on:** 03-runtime-reset
**Part of:** A rewind keeps the session — see [README](./README.md)

## Context

After slice 03, a rewind or a take-back answers with the same Session id and sends `platform/sessionReset` to every viewer engaged before it.
The tab that asked already updates its own thread; every other tab must reload the chat on the same URL.

## Implementation plan

1. **Route the notification** — `packages/ui/src/modules/acp/ext-notifications.ts`: add `platform/sessionReset` to `PLATFORM_NOTIFICATION_METHODS` (~52) and map it in `routeExtNotification` (~66) to `sessionUpdate: "platform_session_reset"`, parsed with the schema from `api-server-api`.
   Add the variant to the union in `packages/ui/src/modules/acp/types.ts` (~12).
   Make `frames-to-messages.ts` ignore it (it never reaches the log, but keep the projection total).
2. **Reload** — `packages/ui/src/modules/sessions/hooks/use-acp-update-handler.ts` (~24): on `platform_session_reset` for the session in view, reload it instead of passing it to `applyUpdate`.
   Reuse the existing full reload: `loadSessionHistory(sid)` then `setMessages(fresh)`, as `loadOlderMessages` does when its cursor is stale (`packages/ui/src/modules/sessions/hooks/use-acp-session.ts` ~250–273; the runtime dropped this channel's cursor, so the load replays from the start).
   Expose it from `use-acp-session.ts` as one `reloadSession()` rather than calling the connection internals from the handler.
   Keep the draft and the scroll position the way a reconnect reload keeps them (`mergeLocalFailures` in `use-acp-connection.ts` ~463–502).
3. **The asking tab skips its own reload.**
   It gets the reset just before its reply (slice 03 sends it first), and it has already cut its thread locally:
   - take-back: `use-take-back-prompt.ts`, same-id branch (~88–92) — `dropMessage()` and `restoreText(sid)`;
   - rewind: `use-acp-session.ts` `rewriteFrom` (~336–385) — `rewrittenThread(...)`.
     Mark a pending local rewrite (the store already has `rewriting` / the take-back's in-flight guard) and ignore a reset that arrives while it is pending for that session.
     A reload there would race the echo of the edited prompt.
4. **Same-id rewind**: in `rewriteFrom`, when `result.sessionId` equals the current id, skip `setSessionId` / `bindEngagement` / the session-list invalidation (they are no-ops or a wasted refetch); keep `rewrittenThread`.
   The take-back hook's new-id branch stays for the fork path.
5. No copy changes: an unexpected cut failure arrives as an error without a code, which the existing rewrite error toast shows; the guard's refusal stays silent (`REWRITE_REFUSED_CODE` catch in `use-take-back-prompt.ts`).

Apply `/react-ui-engineering`.

## Acceptance criteria

- [ ] A second tab on the chat reloads once after a take-back or a rewind in the first, and shows the cut conversation.
- [ ] The tab that asked does not reload: the restored text stays in its input; after a rewind its edited prompt streams with no flicker.
- [ ] The URL does not change in either tab.
- [ ] A fork from a message still opens the new conversation.
- [ ] `mise run //packages/ui:check`, `:check:format`, `:check:lint` and `:test` pass.

## Smoke test

`mise run //packages/ui:test` (covers `rewrite-echo.test.ts`, `rewrite-points.test.ts`).

On the local cluster with the UI rebuilt from this branch (clear the service worker first — the stale-bundle note in `cluster-ops`), run the README's whole-feature smoke test, steps 1–5 and 7.

## As built

- Take-back is optimistic: on Escape the message and its empty reply go at once and the text returns to the input, while the stop and the cut run behind it.
  Updates for that Session are ignored until the runtime answers, so the stop's "stopped" marker never shows.
  A refusal or a failure reloads the Session and takes the restored text back out of the input, unless the user already changed it.
  The operator asked for this after a cluster test: a take-back must look instant, or not happen at all.
- Other tabs reload through `resumeSession`, the path that opens a Session on a fresh socket, since the reset moved their cursors to the end of the refilled log.
