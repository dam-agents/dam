# 03 — The failed turn names the outage

**Depends on:** 01-gateway-call-outcomes
**Part of:** Users see when a model provider is down — see [README](./README.md)

## Context

When a provider fails, the harness gives up after its retries, and the chat shows the raw error text.
Today the hints cover only 401, 402, 429, spend limits and a stopped process (`packages/ui/src/modules/acp/errors.ts`).
This slice makes the failed turn say that the provider did not respond, connects it to a known outage, and adds the mockup's actions: Retry, Switch provider and Raw error.
It also adds the UI status query that slices 04 and 05 reuse.

A failure shows in one of two places today:

- nothing streamed: the user's message becomes undelivered (`UndeliveredNotice`, `components/undelivered-notice.tsx`), with Retry in its "⋯" menu;
- some reply text streamed: the reply ends with `SendErrorCard` (`components/send-error-card.tsx`), "Response interrupted:".

For a provider error, both cases show the mockup's card in the agent's column (README D10).
The failure stays recorded on the user's message, so the resend and the local undelivered record work as before.
Other errors keep today's places and look.

## Implementation plan

Apply `/react-ui-engineering`.
The texts are in [README — Wording](./README.md#wording).
The mockup is the image in [Jenna's issue comment](https://github.com/dam-agents/dam/issues/4253#issuecomment-5923467856); match its content and actions, and reuse `Callout` (`tone="danger"`), `Button` and `Disclosure` with their own sizes.

1. **Status query** in a new UI module `packages/ui/src/modules/provider-status/`:
   - `api/queries.ts`: `useProviderStatus()` on `trpc.providerStatus.list` with `refetchInterval: 60_000` (window-focus refetch stays on, the default); `useOutageFor(templateId)` selects one template's outage or the DAM-side state.
   - `lib/provider-name.ts`: template id → display name with `providerTypeForTemplateId` and `PROVIDERS` from `api-server-api`.
   - `lib/copy.ts`: the card texts of the Wording table, with `getBrand().name` and the start time in local time.
2. **The session's provider.** In `packages/ui/src/modules/sessions/views/chat-view.tsx`, resolve `currentSession.provider` (a Connection id) to its template id with `useAppConnections()`, and pass `{ agentId, templateId }` down to `ChatMessage` (`components/chat-message.tsx`) and from there to `UndeliveredNotice` and `SendErrorCard`.
   Do not edit `model-indicator.tsx` (README D9).
3. **Provider error kind.** In `packages/ui/src/modules/acp/errors.ts`, add a `kind` to `SendErrorDescription` and a rule after the existing ones: status 500, 502, 503, 504 or 529, "overloaded", "service unavailable", "bad gateway", "gateway timeout", "upstream connect error" or "upstream request timeout" → `kind: "provider-unavailable"`.
   Keep the existing results for every other error.
4. **Card content.** A new `modules/provider-status/components/provider-error-content.tsx` picks the title and hint from the kind, the provider name and `useOutageFor(templateId)`:
   - status OK or unknown → "didn't respond";
   - degraded → "has had problems since {time}";
   - DAM side → the DAM-side text;
   - the card saw the template degraded and it is healthy now → the "works again" hint (keep that memory in a `useRef`, it is local UI state).
5. **Actions.** A new `modules/provider-status/components/provider-error-actions.tsx`:
   - **Retry**: a visible button that calls the existing resend (`retryHandlerFor` in `undelivered-notice.tsx`); only where a resend exists, so not on an interrupted reply.
   - **Switch provider**: `navigateToSandboxHome(agentId, "providers")` from `modules/platform/store/navigation.ts`.
   - **Raw error**: a `Disclosure` that shows the original error text.
     Make Retry and Raw error reusable without the provider parts, so the rejected-key card of #4355 can use them.
6. **The card's place (README D10).** When the kind is `provider-unavailable`:
   - nothing streamed: `ChatMessage` keeps the red border on the user's bubble, shows no inline marker, and renders the card under the bubble in the agent's column, after an agent label, as in the mockup.
     The card's "⋯" menu holds Copy text and Delete, which the marker's menu held.
   - reply text streamed: `SendErrorCard` renders the provider content and actions; keep "Response interrupted:".
     Other errors look as before.
7. **Refresh after a failure.** In `packages/ui/src/modules/sessions/hooks/use-acp-prompt.ts`, `failUserMessage` and `interruptTurn` invalidate the `providerStatus.list` query, so the card reads a fresh status at once.
8. **Docs:** `docs/architecture/provider-status.md` gets a Screens section with the card: when it shows, its texts by state, and its actions.

## Acceptance criteria

- [ ] `mise run check` and `mise run //packages/ui:test` pass.
- [ ] A 503 from the provider shows "Send failed: {Provider} didn't respond."
  with the hint, Retry, Switch provider and Raw error.
- [ ] With the template degraded, the card shows "since {time}" and "Your setup is not the cause."
- [ ] With the DAM-side state, the card blames no provider.
- [ ] When the outage ends while the card is visible, the hint changes to "{Provider} works again.
  Retry now."
- [ ] Retry resends the saved message; Switch provider opens the agent's Providers section; Raw error shows the original text.
- [ ] With nothing streamed, the card shows under the user's message in the agent's column, as in the mockup, and its "⋯" menu has Copy text and Delete.
- [ ] An interrupted reply keeps "Response interrupted:" and has no Retry.
- [ ] 401, 402, 429, spend-limit and other errors look exactly as before.
- [ ] `model-indicator.tsx` and `session-projection.ts` are unchanged.

## Smoke test

On the dev cluster, with the UI image rebuilt:

1. Turn the IBM VPN off and send a message to an agent on IBM LiteLLM: the undelivered message shows the "didn't respond" card with its three actions.
2. Send to a second agent on IBM LiteLLM; within about 2 minutes, a new failure shows "since {time}".
3. Click Raw error, then Switch provider (the Providers section opens), go back and click Retry.
4. Turn the VPN on; within about 6 minutes, the open card says "works again", and Retry gets an answer.

Print a short guide so Petr can repeat it by hand, with screenshots for the PR.
