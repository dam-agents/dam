# 04 — Allowance on the screens

**Depends on:** 03-allowance-gate
**Part of:** Built-in model provider — see [README](./README.md)

## Context

This slice makes the built-in provider and its allowance visible, so a turn never fails without warning (user story 2 of #5057), and points the user to their own provider when the allowance runs low (user story 3).

## Implementation plan

Apply `/react-ui-engineering`.
Read the allowance from `spend.status` (pinned in the README) with the existing TanStack Query hooks #4731's screens use; read `builtIn` from the connection view.

1. **Settings → Providers** (`packages/ui/src/modules/providers/components/provider-section.tsx`, `provider-row.tsx`):
   - A built-in row shows a badge "Included with <brand>" (`getBrand()` from `packages/ui/src/brand.ts`), no delete, rename or rotate actions, and the allowance meter ("1.2M of 5M tokens today · resets <local time>") in place of `provider-balance.tsx`.
   - A withdrawn one reads as expired with the text "No longer included with <brand>."
   - Under the section, while the user has only built-in providers: one line "Using the included models.
     Connect your own provider for more."
     with the existing connect action.
2. **Agent page** (Providers section `sandbox-providers-section.tsx` and the Usage section from #4731): the same badge and meter on the built-in grant; the Connection-limit field is replaced by the not-limitable reason from slice 03.
3. **Chat composer** (`packages/ui/src/modules/sessions/views/chat-view.tsx`): when the session's pair is on a built-in Connection and the allowance state is `warn` or `reached`, a slim notice above the composer: "80% of today's included model allowance is used."
   / "Today's included model allowance is used up.
   It resets at <local time>."
   with a "Connect your own provider" button opening `ProviderSettingsModal`.
   The send button stays (an own provider in the picker still works).
4. **Error hint** (`packages/ui/src/modules/acp/errors.ts`): map the allowance refusal text to the same call to action, before the generic 402 "top up your provider" hint, which is wrong for a built-in Connection.
5. **Settings → Usage tab and Home spend widget** (from #4731): one allowance meter beside the dollar view.
6. Accessibility: meters carry `role="meter"` with `aria-valuenow/min/max` and a text label; the notice is a polite live region; colours are not the only signal (the text says the state).
7. **Docs** (same commit): the "Screens" section of `docs/architecture/spend-limits.md` and the provider listing in `docs/architecture/connections.md`.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass.
- [ ] A built-in Connection shows the badge, the meter and no destructive actions in Settings and on the agent page.
- [ ] At 80% and at 100% the composer notice appears on a built-in session and not on an own-provider session.
- [ ] The refused turn shows the "connect your own provider" action, not the generic top-up hint.
- [ ] Screenshots of each screen are attached to the PR (repo rule for UI changes).

## Smoke test

On the dev cluster as in slice 03, lower the allowance to cross 80% and then 100%:

1. Settings → Providers: badge and meter update after a prompt.
2. Chat: the 80% notice, then the used-up notice with its reset time in local time; "Connect your own provider" opens the connect modal.
3. Connect an own provider: the session picker offers it, and a new session on it has no notice.
4. Capture each screen with agent-browser (`export AGENT_BROWSER_SESSION=feat-5057-built-in-model-provider` first).
