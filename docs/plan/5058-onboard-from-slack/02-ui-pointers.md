# 02 — Slack points to the UI

**Depends on:** 01-dm-onboarding
**Part of:** Onboard and create agents from Slack — see [README](./README.md)

## Context

User story 3 of #5058: Slack tells people what it cannot do and links to the exact place in the UI.
Today an egress hold on a Slack turn is visible only on Home and the person is never told; a Slack-only user would never find it.
This slice adds three pointers and changes no permissions.

## Implementation plan

Apply `/typescript-engineering`.
All links are built from the UI base URL the Slack OAuth routes already use; copy uses `config.brand`, never a literal.

1. **Welcome message.** After `complete` in slice 01 creates the assistant (not on later binds), the app (no agent persona) posts one message in the DM:
   - what works in Slack: DM the assistant, `/<brand> new` in a channel (slice 03), `/<brand> whisper`, `/<brand> help`;
   - "More in <brand>" with links: connect your own model provider (Settings → Providers), connect accounts such as GitHub (Settings → Connections), approvals (Home), the assistant's settings (its agent page).
     Build it as Slack blocks in one function in the Slack worker so slice 03's help reuses the links.
2. **Help.** The bare `/<brand>` usage text (`handleCommand`) gets the same "More in <brand>" block; the eight verbs listed today stay.
3. **Owner DMs for UI-only blocks**, sent with `notifyPerson(ownerSub, …)` to the agent's owner, at most once per agent, reason and hour (a Redis key with a TTL), only when the blocked work was a channel turn.
   The person in the conversation stays informed as today (the existing ephemeral or notice); the DM goes to the owner, who may be someone else:
   - **Egress approval pending:** a saga on `EventType.ApprovalRequested` (`packages/api-server/src/events.ts`) for an approval whose session is a channel turn: "<agent> needs your approval to reach <host>." + link to Home's approval card.
   - **No provider:** where a channel turn finds no provider for its pair: "<agent> has no model provider." + link to the agent's Providers section.
   - **Built-in allowance used up** (#5057 slice 03's `allowance` block, when present on the branch): "Today's included model allowance is used up." + link to Settings → Providers.
     If #5057 is not merged when this slice is built, leave this case out and note it in the PR body.
4. **Docs** (same commit): `docs/architecture/channels.md` ("The platform can message a linked person": the new notices), `docs/architecture/slack-guarantees.md` (an egress hold on a Slack turn now reaches the owner).

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass.
- [ ] The welcome message arrives once, after the assistant is created, with working links.
- [ ] `/<brand>` with no verb shows the "More in <brand>" block.
- [ ] A Slack turn that hits an egress approval DMs the owner one link to the approval; a second hold within the hour sends nothing more.

## Smoke test

On the dev cluster after slice 01's smoke test:

1. Check the welcome message; open each link (agent-browser or a browser) and land on the named page.
2. Run `/<brand>`: the block is there.
3. In the DM ask the assistant to `curl https://example.org`: the owner DM with the approval link arrives; Home shows the card.
