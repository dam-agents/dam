# 07 — Bind picker redesign

**Depends on:** 01-channel-name-resolution
**Part of:** UI — Slack integration discoverability — see [README](./README.md)

## Context

The page the messenger link opens is where the user actually picks an agent, and today it is a
bare list. With the bind flow becoming the advertised path, this page carries much more traffic.
The redesign adds search, grouping and enough per-agent detail to choose confidently.

Both messengers get it. Telegram's page is the same design, differing only where Telegram itself
differs.

Apply the `/react-ui-engineering` skill.

## Ask for the Figma frames first

- Picker, populated — **views 7, 17, 24**
- Picker with a search term typed, nothing selected — **view 8**
- Picker with a row selected and the action enabled — **view 9**

There are no Telegram frames. Build Telegram from the Slack ones plus the differences below, and
ask for frames if a Telegram-specific state is unclear.

## Implementation plan

1. **Header.** "Pick an agent for `#design-dev`" — the conversation name, resolved. Below it:
   "Choose which agent to add to this channel. You can add more agents to the same channel later."

   For Telegram: the chat title without a `#`, and **no** "add more agents later" sentence — a
   Telegram conversation binds to exactly one agent, and the code refuses a second bind. Word it
   for one agent.

2. **Search.** A search input filtering by agent name and description. Section headers stay
   visible over the filtered set. An empty result says so.

3. **Two sections.** "MOST RECENT" then "A – Z". Per the annotation on view 7, "most recent"
   means **most recently created** — order by creation date descending, not by last use. The
   alphabetical group sorts by name.

4. **Card rows.** Each agent shows its name, any contribution-failure badge, a size subtitle
   (`2 CPU · 2 Gi`), and badges for its channels and schedules — the channel badge holding up to
   two names with a `+N` remainder, the schedule badge reading "N active schedules". A status
   badge sits right: Working, Hibernating, Starting, Error, Over budget, with the power icon on
   agents that never hibernate.

5. **Single selection and a sticky action.** One row selects at a time, with a visible selected
   state. A sticky footer holds "Add to channel", disabled until something is selected. For
   Telegram, word the action for a chat.

6. **Keep inline agent creation.** Both bind pages offer "+ Create a new agent" today, and both
   swap to dedicated copy when the user owns none. No Figma frame shows it, but removing it would
   strand a user with no agents on a dead-end page — the exact moment the feature is meant to
   convert someone. **Keep the behaviour and restyle it** to the new design.

7. **Keep every terminal state.** Missing flow id, expired link, callback errors. These are the
   real failure modes of a link-driven flow and none is drawn in Figma. Restyle, do not remove.

8. **Keep the existing consent copy's meaning.** The current page tells the user that everyone in
   the conversation will be able to drive the agent under its own credentials and their acceptance
   of the Terms of Use. That statement is load-bearing. If the redesign's shorter copy drops it,
   keep it somewhere on the page and flag the change in the PR.

## Acceptance criteria

- [ ] The header names the conversation — `#name` for Slack, the bare title for Telegram.
- [ ] Search filters by name and description and reports an empty result.
- [ ] Agents group into Most recent, ordered by creation date descending, then A – Z.
- [ ] Rows show size, channel and schedule badges, and the right status badge.
- [ ] Exactly one row selects at a time; the sticky action enables only then.
- [ ] Inline agent creation still works, including for a user who owns no agents.
- [ ] Every terminal error state still renders, restyled.
- [ ] The consent statement is still on the page.
- [ ] Telegram's page reflects one-agent-per-conversation in its copy.
- [ ] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

```bash
mise run check && mise run test
```

On the local dev cluster, run `/dam bind` in a Slack channel and follow the link. Confirm the
header names the channel, that search narrows the list, that the two sections appear in the right
order, and that "Add to channel" stays disabled until you pick a row. Complete the bind. Open the
link a second time and confirm the expired-flow state renders. Visit the page with no flow id and
confirm the terminal message. Repeat the whole pass in Telegram with `/dam bind` in a group.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
