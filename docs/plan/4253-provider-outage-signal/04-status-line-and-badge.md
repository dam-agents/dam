# 04 — Status line and Providers badge

**Depends on:** 03-failed-turn-card
**Part of:** Users see when a model provider is down — see [README](./README.md)

## Context

During an outage, a turn can show "working…" for minutes while the harness retries, before the card of slice 03 appears.
This slice shows the cause earlier, in the session that uses the failing provider, with a status line above the message box.
It also marks the provider as degraded where users manage providers: the row in Settings › Providers.
Both read `useProviderStatus()` from slice 03.

## Implementation plan

Apply `/react-ui-engineering`.
The texts are in [README — Wording](./README.md#wording).

1. **Status line** in a new `packages/ui/src/modules/provider-status/components/provider-status-line.tsx`:
   - props: the session's template id and whether a turn runs;
   - renders nothing when the template is healthy or unknown;
   - copies the look of `PermissionStatusLine` (`modules/sessions/components/permission-prompt.tsx`): the same container classes and the warning dot, with the Wording text for "turn running", "idle" or "DAM side".
     If the two lines need the same container, extract it once into a shared component in the sessions module rather than copying the classes.
2. **Mount** in `packages/ui/src/modules/sessions/views/chat-view.tsx`, next to `PermissionStatusLine` (`{!statusLineInThread && <PermissionStatusLine />}`), with the template id from slice 03 and `busy` for the running turn.
   Both lines may show at once; the permission line stays first.
   Do not edit `model-indicator.tsx` (README D9).
3. **Badge.** `packages/ui/src/modules/providers/components/provider-row.tsx` gets an optional `degraded` prop: when the row is connected and `degraded` is true, the existing `Badge` shows `variant="warning"` and "Degraded" instead of "Connected".
4. **Badge data.** `packages/ui/src/modules/providers/components/provider-section.tsx` computes `degraded` per row from `useProviderStatus()`: a row is degraded when any Connection template of its provider type (for Anthropic: `anthropic` and `anthropic-oauth`) has an outage, or the DAM-side state is set.
5. **Docs:** `docs/architecture/provider-status.md` § Screens: the status line and the badge.

## Acceptance criteria

- [ ] `mise run check` and `mise run //packages/ui:test` pass.
- [ ] A session on a degraded provider shows the status line; a session on a healthy provider does not.
- [ ] The line says "the agent keeps trying" while a turn runs and "messages may fail" when idle.
- [ ] With the DAM-side state, every session with a provider shows the DAM-side line.
- [ ] Settings › Providers shows "Degraded" on the failing provider's row only, and "Connected" again after recovery.
- [ ] The permission line still shows when an approval waits.
- [ ] `model-indicator.tsx` is unchanged.

## Smoke test

On the dev cluster, with the UI image rebuilt:

1. Turn the IBM VPN off; make two IBM LiteLLM agents fail as in slice 01.
2. Open a session on IBM LiteLLM: within about 2 minutes the status line shows; send a message and see "the agent keeps trying" while it runs.
3. Open a session on the Claude subscription: no line.
4. Open Settings › Providers: IBM LiteLLM shows "Degraded"; the others show "Connected".
5. Turn the VPN on: within about 6 minutes, the line goes and the badge says "Connected".

Print a short guide so Petr can repeat it by hand, with screenshots for the PR.
