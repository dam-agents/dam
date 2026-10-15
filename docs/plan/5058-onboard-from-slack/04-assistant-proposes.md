# 04 — The assistant proposes a channel agent

**Depends on:** 03-new-command
**Part of:** Onboard and create agents from Slack — see [README](./README.md)

## Context

The natural-language form of user story 2: in the DM, the person asks their Slack Assistant for an agent in a channel.
An agent that creates agents is a target for prompt injection (a whisper, a pasted document), so the assistant only **proposes**; the owner creates by clicking a button the app posts.
This slice can be cut without affecting 01–03 (PROPOSED D7).

## Implementation plan

Apply `/typescript-engineering`.

1. **MCP tools** in the platform MCP (`packages/api-server/src/apps/harness-api-server/mcp-endpoint.ts`, or a `mcp-tools.ts` in the channels module registered the way `metrics` and `kb-shares` register theirs), registered only when the calling agent carries `agent-platform.ai/assistant=slack`:
   - `list_starter_kits()` → the kits its owner can apply: id, name, description, required connections and whether the owner holds them.
   - `propose_channel_agent({ channel, kit?, name? })`: `channel` is a Slack channel id or `#name`, resolved in the workspaces of the owner's Slack identity links; refuses an unknown or ambiguous channel with candidates.
     It posts a proposal to the owner through `notifyPerson`-style delivery (app, no persona), in the workspace of that channel: "Create <name> from <kit> in #channel?"
     with **Create** and **Cancel** buttons, and returns `{ proposed: true }`.
     It never creates anything.
     At most 5 open proposals per owner (Redis, 24 h TTL).
     Describe both tools so the model knows the owner must click.
2. **Buttons.** Register `bolt.action` handlers in `bolt-slack-gateway.ts` (interactivity is already on in the manifest), routed to a worker handler:
   - The button value carries a proposal id; the proposal (owner, team, conversation, kit, name) is stored server-side in Redis, never trusted from the payload.
   - Only a click by a Slack user linked to the proposal's owner acts; anyone else gets an ephemeral refusal.
   - **Create** calls slice 03's `createChannelAgent` and replaces the message with the result (or the typed refusal with its UI link); **Cancel** replaces it with "Cancelled".
     A second click does nothing.
3. **Docs** (same commit): `docs/architecture/channels.md` (proposals and the button gate), `docs/architecture/slack-guarantees.md`, `docs/architecture/security-and-credentials.md` (why the assistant cannot create directly).

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass.
- [ ] Only the marked assistant sees the two tools; another agent of the same owner does not.
- [ ] Asking the assistant for an agent in a channel posts one proposal; Create creates and binds it; Cancel creates nothing.
- [ ] A click by someone other than the owner is refused; a second click on a used proposal does nothing.

## Smoke test

On the dev cluster after slice 03:

1. In the assistant's DM: "Create an agent for #<test-channel> from the micro-manager kit."
   A proposal with buttons arrives.
2. Click Create: the agent is created, bound, and answers a mention in the channel.
3. Ask for another, click Cancel: nothing is created.
4. Ask a second agent of the same owner (not the assistant) the same: it has no such tool and says so.
