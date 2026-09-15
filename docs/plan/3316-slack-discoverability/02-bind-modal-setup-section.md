# 02 — Bind walkthrough modal and setup Channels section

**Part of:** UI — Slack integration discoverability — see [README](./README.md)

## Context

This is where the feature becomes discoverable: a **Channels** section on the agent setup page,
offered before the first agent exists. Ticking a messenger there opens a walkthrough after
creation that tells the user how to finish in Slack or Telegram. The same modal is later reached
from the agent list and the chat launcher, so it is built here as a shared component with three
callers in mind.

Apply the `/react-ui-engineering` skill.

## Ask for the Figma frames first

**Request these before writing any component.** This plan gives behaviour and copy; the frames
give colours, spacing, sizes and state styling.

- Setup Channels section, unchecked / Slack checked / Telegram checked / both checked — **views 1, 3, 11, 12, 14**
- "Add to Slack Channel" modal, single — **view 4** (also 23, 28)
- "Add to Telegram Chat" modal, single — **view 13**
- Two-step modal, step 1 and step 2 — **views 15, 16**

## Implementation plan

1. **Build the Channels section** for the setup page. Two selectable rows, each with the
   messenger icon, a label, a one-line description and a **checkbox** on the right:

   | Row | Description |
   |---|---|
   | Slack Channel | You can interact with the agent in your DMs, or bind it to a channel for your team to use. |
   | Telegram Chat | Your team can interact with the agent in a Telegram group or DM. |

   The rows are **independent checkboxes** — both can be ticked at once. The prototype draws a
   radio dot here and is wrong; Figma shows a square checkbox in every frame.

   Label the Telegram row **"Telegram Chat"**. View 14 says "In a Telegram chat", but it is the
   only frame that does, it reuses wording from a dead prototype component, and every other
   surface — the modal title, the overflow menu — says "Chat".

   The Slack row carries a `?` affordance. Leave a slot for it; sub-issue 03 fills it.

2. **Handle an install with no messenger.** When neither Slack nor Telegram is configured, show
   the existing explanatory line rather than hiding the section — production's
   [`sandbox-channels-section.tsx`](../../../packages/ui/src/modules/sandboxes/components/sandbox-channels-section.tsx)
   points the user at their operator. The prototype returns `null` here, which silently removes
   the feature; do not copy that. Hide only a messenger that is individually unavailable.

3. **Place the section last** on the setup page, after My Connections.

4. **Build the bind modal** as one component driven by which messengers were requested. Title is
   the messenger icon plus "Add to Slack Channel" or "Add to Telegram Chat". Content is three
   numbered steps, with copyable commands:

   **Slack** — 1. "Invite the bot to your channel (to DM, skip this step)" / "In the Slack channel
   your team already uses, run:" `/invite @DAM` · 2. "Run the bind command there" / "Then, in the
   same channel, run:" `/dam bind` · 3. "Pick this agent on the page Slack opens" / "Follow the
   link Slack posts, pick this agent, and confirm. That confirmation grants the access."

   **Telegram** — 1. "Add the bot to your chat" / "Add this installation's Telegram bot to the
   Telegram group your team already uses. For a one-to-one chat, open it directly." · 2. "Send the
   bind command there" / "In that chat, send:" `/dam bind` / "In a group, only admins can run
   this." · 3. "Pick this agent on the page Telegram opens" / "Follow the link the bot posts, pick
   this agent, and confirm. That confirmation grants the access. The link works for about 10
   minutes."

   Brand strings come from `getBrand()` — never hardcode `DAM` or `dam`.

   Keep the **"Open @handle in Telegram ↗"** button under Telegram step 1, shown only when the
   installation's bot username is known. Figma's frame shows the no-handle fallback, which is why
   the button is absent there.

5. **Footers.** One messenger: a single `[Done]`. Both messengers: step 1 shows
   `[Close] [Set up Telegram next]`, step 2 shows `[Back] [Done]`, with a "Step 1 of 2" /
   "Step 2 of 2" subtitle. Figma draws the Slack-only modal with no footer at all; that is the
   only state without one and reads as an oversight, so **give it `[Done]`** to match its
   siblings. Flag this in the PR.

6. **Wire the post-create trigger.** On successful create, record the chosen messengers and open
   the modal for them. The prototype's localStorage intent marker exists to survive the redirect
   to Slack and back — keep that idea, but do not copy its implementation uncritically.

7. **Wire all three setup views** — coding agent, experiment and knowledge base — since all three
   create an agent that can hold channels.

## Acceptance criteria

- [ ] The Channels section appears last on all three setup pages, with both rows as checkboxes.
- [ ] Both rows can be selected at the same time, and each shows a clear checked state.
- [ ] With no messenger configured, the section explains that rather than disappearing.
- [ ] Creating an agent with one messenger opens its modal with a `[Done]` footer.
- [ ] Creating with both opens a two-step modal: "Step 1 of 2" then "Step 2 of 2", with working
      Back and Set up Telegram next.
- [ ] Every command is copyable, and brand strings come from `getBrand()`.
- [ ] The Telegram handle button appears when a bot username is configured and is absent otherwise.
- [ ] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

```bash
mise run check && mise run test
```

Then on the local dev cluster: open agent creation, tick both channel rows, and create. Confirm
the two-step modal opens, that Back and Set up Telegram next move between the steps, that Done
closes it, and that each command copies. Repeat with only Slack ticked, then only Telegram, and
confirm each opens a single-step modal with a Done button. Finally, check the same section
appears on the experiment and knowledge-base setup pages.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
