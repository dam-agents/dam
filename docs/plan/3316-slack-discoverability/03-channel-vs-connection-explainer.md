# 03 — Channel vs connection explainer

**Depends on:** 02-bind-modal-setup-section
**Part of:** UI — Slack integration discoverability — see [README](./README.md)

## Context

This is the trust half of the issue. A user added a Slack **connection** expecting a channel
binding, and only later discovered the agent was acting as them. A recent interview reproduced
the confusion. This slice names the two paths apart and explains each at the point of choice.

One explainer component, three placements, plus a rename that does much of the work on its own:
the catalogue provider becomes **"Slack Account"**, which pairs against **"Slack Channel"**.

Apply the `/react-ui-engineering` skill.

## Ask for the Figma frames first

- Setup page with the Slack explainer open — **views 2, 19**
- Connection catalogue with the Slack Account explainer open — **view 20**
- Agent Channels section showing the `?` on the Slack card — **view 29**

View 2 also carries the designer's annotations; read them with the frame.

## Implementation plan

1. **Build one accessible explainer component.** A `?` affordance that reveals a short card.

   It must be a real focusable `<button>` whose card opens on **click, Enter and Space**, and
   **also** on hover for pointer users, closing on Escape and on blur. The prototype uses a
   hover-only card, which is unreachable by keyboard and on touch. That is not acceptable here:
   the card carries the warning that the agent will act as the user, which is the point of the
   whole issue. Reach for a popover primitive rather than a hover-card primitive, and add hover
   opening on top.

   The card takes its content and an optional cross-link from props, so all three placements share
   one implementation.

2. **Rename the catalogue provider to "Slack Account".** It reads "Slack" today. The rename is
   user-visible naming only — do not touch the template id, the `iconSlug`, or any stored
   Connection.

3. **Placement one — setup page**, on the Slack Channel row (the slot left by sub-issue 02):

   > With Channels, you can DM or bind your agent to a team channel. The agent answers as itself
   > always.
   >
   > If you want to give this agent access to your Slack Account, that's a Connection.
   >
   > **Go to Connections →**

4. **Placement two — connection catalogue**, on the Slack Account card header:

   > With a Slack Account connection, the agent works in your Slack as you. It can search, read
   > and post anywhere your account can — including private channels and DMs.
   >
   > If you want to DM your agent or use it collaboratively with others in a team channel, add it
   > to a channel instead.
   >
   > **Go to Channels →**

   Note "a **Slack Account** connection" — the prototype says "a Slack connection" and predates
   the rename.

5. **Placement three — agent Channels section**, on the Slack card header. Same content as
   placement one. Sub-issue 05 owns the rest of that section; only the `?` belongs here.

6. **Wire "Go to Connections →".** Per the designer's annotation on view 2, it opens the
   **Connections modal**. Opened from setup it is **agent-scoped** — view 20 shows rows offering
   "+ Add to agent" — so carry the agent context through rather than opening the plain global
   catalogue.

7. **Wire "Go to Channels →".** Close the catalogue modal and return the user to the Channels
   section they came from, bringing it into view. Where there is no agent in context — the global
   Connections settings page — render the phrase as **plain text rather than a dead link**. The
   prototype already models this with an optional handler; keep that shape.

   *Assumption, unannotated by the designer.* Flag it in the PR.

8. **Telegram gets no explainer**, in any placement. There is no Telegram connection template, so
   there is no confusion to resolve. Every Figma frame agrees.

## Acceptance criteria

- [ ] One component serves all three placements.
- [ ] The card opens on click, on Enter, on Space and on hover; Escape closes it; the trigger is
      reachable by Tab and has an accessible name.
- [ ] The card is usable on a touch device, verified at mobile width.
- [ ] The catalogue provider reads "Slack Account"; no template id, icon slug or stored Connection
      changed.
- [ ] Both texts match the copy above exactly.
- [ ] "Go to Connections →" opens the catalogue modal carrying the agent's context.
- [ ] "Go to Channels →" returns to the Channels section, and renders as plain text where no agent
      is in context.
- [ ] No Telegram row or card shows a `?`.
- [ ] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

```bash
mise run check && mise run test
```

On the local dev cluster, open agent setup. Hover the `?` on the Slack row, then reload and reach
it with Tab and Enter instead — the same card must appear both ways, and Escape must close it.
Follow "Go to Connections →" and confirm the catalogue modal opens with the agent in context and
shows **Slack Account**. Open its `?`, read the reverse explanation, and follow "Go to Channels →"
back to the Channels section. Then open Settings → Connections directly and confirm the same card
appears there with the phrase as plain text, not a link. Finally, narrow the window to mobile
width and confirm the card can be opened by tap.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
