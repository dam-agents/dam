# 03 — `/<brand> new` and `/<brand> kits`

**Depends on:** 01-dm-onboarding
**Part of:** Onboard and create agents from Slack — see [README](./README.md)

## Context

User story 2 of #5058: a person creates an agent for a channel without leaving it.
Today the in-chat path only binds an agent that already exists, through a web picker.
This slice adds a create-and-bind command and a kit listing, both on the one existing slash command, so no manifest change is needed.

## Implementation plan

Apply `/typescript-engineering`.

1. **Service.** In the channels module next to the onboarding service: `createChannelAgent({ owner, teamId, conversationId, kitRef?, name? })`, which slice 04 calls too:
   - no kit: the agents service's plain create with `name` or the conversation's name (`describe` it through the worker; fall back to "<brand short> agent"), then bind through the bind-flow path slice 01 uses;
   - kit: resolve `kitRef` (`<catalog>/<kit>` or a bare kit id matched across catalogs, refusing an ambiguous one with the candidates) and call `starterKits.apply({ …, slackChannelId: conversationId })`, which binds;
   - a refused requirement returns the missing connections and the kit's UI URL;
   - errors are typed (`KitNotFound`, `KitAmbiguous`, `RequirementsMissing`, `BotNotInConversation`, `GroupDmWithoutBot`), reusing the bind refusals that exist.
2. **Command** (`handleCommand` in `packages/api-server/src/modules/channels/infrastructure/slack.ts`):
   - `new [kit] [name…]`: linked → call the service and answer ephemerally ("Created <agent> and connected it here.
     Mention @<bot> to talk to it."
     plus the agent's UI link); unlinked → a login link with a new pending intent `new` carrying the conversation, team, kit and name, whose OAuth callback calls the service and shows the existing "Account linked" page with the result.
     The callback also needs the Terms: when not accepted, redirect to slice 01's welcome page in a `new` mode that accepts the Terms and then calls a `slack.completeNew({ flowId })` procedure (same shape as `completeOnboarding`).
   - `kits`: an ephemeral list of the kits the person can apply (id, name, one-line description; at most 20, then a link to the catalog in the UI).
   - Add both verbs to the bare-command usage list.
   - In a 1:1 DM, `new` is refused with "Run this in the channel the agent is for."
3. **Docs** (same commit): `docs/architecture/channels.md` (in-chat create beside in-chat binding; the verbs), `docs/architecture/starter-kits.md` (apply from Slack), `docs/architecture/slack-guarantees.md`, `docs/architecture/cli.md` only if the CLI gains nothing (say Slack-only verbs are not CLI).

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass.
- [ ] `/<brand> new` in a channel with the bot creates one agent owned by the person, bound there, default when the channel had none.
- [ ] `/<brand> new <kit>` applies the kit with its schedules and binds the channel; a kit with missing required connections is refused with its UI link and creates nothing.
- [ ] An unlinked person completes `new` through one sign-in.
- [ ] In a channel without the bot, the existing "invite the app first" refusal is returned.

## Smoke test

On the dev cluster with a test channel that has the app:

1. `/<brand> kits` lists kits.
2. `/<brand> new`: ephemeral success; `@<bot> hello` answers.
3. `/<brand> new micro-manager standup`: the agent appears in `dam agent list` with its kit stamp and schedules (`dam schedule list <agent>`).
4. `/<brand> new code-guardian` (requires GitHub) as a user without GitHub: refused with the link.
