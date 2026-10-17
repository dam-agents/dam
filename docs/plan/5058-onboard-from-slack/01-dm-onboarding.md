# 01 — A first DM creates the Slack Assistant

**Part of:** Onboard and create agents from Slack — see [README](./README.md)

## Context

This slice is user story 1 of #5058: a person DMs the app and ends up with an assistant in that DM, with one sign-in as the only step outside Slack.
It reuses the existing login flow, bind flow and create path; what is new is an `onboard` intent, a welcome page that also takes the Terms, and a server-side create-and-bind in place of the agent picker.

## Implementation plan

Apply `/typescript-engineering` (server, contract) and `/react-ui-engineering` (welcome page).

1. **Chart and config.** `helm/values.yaml`, under `apiServer` beside the Slack values: `slackOnboarding: { enabled: false, starterKit: "" }` (PROPOSED D1, D8), commented; env in `helm/templates/apiserver/app.yaml`; `packages/api-server/src/config.ts`.
2. **Unbound DM** (`packages/api-server/src/modules/channels/infrastructure/slack.ts`, the `!routed` branch of `handleInbound` for a 1:1 DM, where `unboundConversationCopy` is posted today).
   With onboarding enabled:
   - **Unlinked sender:** post (in the DM, not ephemeral, so it stays) "Sign in with your <brand> account to get your assistant."
     with the sign-in link from a new pending OAuth flow, `intent: "onboard"`, carrying the DM id, team id, and the triggering message's `ts` and text (bounded to Slack's message size; kept only in the pending flow, which already expires).
     Extend `SlackOAuthPending.intent` to `"login" | "bind" | "onboard"`.
     One pending onboarding per Slack user: a second DM while one is pending re-posts the same link.
   - **Linked sender:** call the onboarding service (step 4) directly; if it returns `TermsNotAccepted`, post the welcome-page link instead.
   - With onboarding disabled, keep today's copy.
3. **Callback** (`infrastructure/slack-oauth.ts`): for `onboard`, after the identity link, mint a bind flow (`bindFlows.create`, as `bind` does, plus the replay fields) and redirect to `${uiBaseUrl}/slack/welcome?flow=<id>`.
4. **Onboarding service** (channels module, `services/slack-onboarding.ts`), composed in `bootstrap.ts` with the per-owner agents and starter-kit services:
   - `peek(flowId)` and `complete(flowId)` per the README contract.
   - `complete`: refuse `TermsNotAccepted` (terms module's latest acceptance); find the owner's agent with annotation `agent-platform.ai/assistant=slack` (agents repository `list` + annotation, or a label if listing by annotation is too slow — decide by the repository's existing filters); else create it:
     - plain: the agents service create with name `${brand.short} assistant`, default Template, no provider named (the create path picks the default and, with #5057, ensures the built-in one);
     - kit: `starterKits.apply` with the configured kit; on a refused requirement, fall back to plain and log a warning naming the kit.
     - Set the annotation in the same create call (`agents-repository.ts` `create(…, annotations)`).
   - Bind it to the DM with `bindSlackChannel(agentId, flowId)`; an existing binding of that agent there is success.
   - Replay: hand the stored message to the channel worker over the ChannelManager RPC as a turn for that DM, as if just received, attributed to the person (the DM relay path already speaks for a single human), so the reply threads under their original message.
   - Idempotent: completing the same flow twice returns the same agent with `created: false`.
   - Audit-log the create with surface `slack`.
5. **Contract and router.** `slack.peekOnboarding` and `slack.completeOnboarding` (README), next to `agents.peekSlackBindFlow`; authenticated procedures (the flow names the Slack user, the session names the owner; refuse a flow whose `keycloakSub` is not the caller).
6. **Welcome page** (`packages/ui/src/modules/slack/views/slack-welcome-view.tsx`, routed like `slack-bind-view.tsx`):
   - Peek; when the Terms are not accepted, render the existing terms view content with its accept action, then continue.
   - Call `completeOnboarding`; show "Your assistant is ready" and a primary "Back to Slack" link (`slackDeepLink`: `slack://channel?team=<team>&id=<dm>`, with the https `app.slack.com/client/<team>/<dm>` fallback).
   - A small secondary line: "or open <brand>" to Home.
   - Errors: an expired flow says to DM the app again.
   - Accessible: one heading, the primary action focused after completion, no colour-only states.
7. **Docs** (same commit): `docs/architecture/channels.md` (DMs and identity linking: the onboard intent, the welcome page, the mark, replay, linked shortcut), `docs/architecture/slack-guarantees.md` (what a first DM guarantees), `docs/architecture/agent-lifecycle.md` (one more creator), `docs/ubiquitous-language.md` (Slack Assistant, Slack Onboarding).

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass.
- [ ] An unlinked person's first DM yields one sign-in link; after sign-in and Terms, exactly one agent with the `assistant=slack` mark exists, bound to that DM as default.
- [ ] The first message is answered in the DM without being re-sent.
- [ ] A linked person with accepted Terms gets the assistant on their first DM with no link.
- [ ] A second DM, a second completion of the flow, or a DM from a second workspace creates no second assistant (the second workspace's DM gets a binding of the same agent).
- [ ] With `slackOnboarding.enabled: false`, an unbound DM answers exactly as before.

## Smoke test

On the dev cluster with a test Slack workspace and `slackOnboarding.enabled: true`:

1. `/<brand> logout` as a test member; DM the app "hello".
2. Follow the link, sign in as `dev`, accept the Terms if shown; the page says ready.
3. Back in Slack: the assistant replies to "hello" under that message.
4. `dam agent list` shows `<brand short> assistant`; `mise run cluster:kubectl -- get agents -n platform-agents -o jsonpath='{.items[*].metadata.annotations}'` shows the mark (dev cluster only).
5. DM again: answered by the same agent; no new agent.
