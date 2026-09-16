# 04 — Channel visibility on the agent list and chat launcher

**Depends on:** 01-channel-name-resolution, 02-bind-modal-setup-section
**Part of:** UI — Slack integration discoverability — see [README](./README.md)

## Context

Two surfaces where an existing user should meet the capability: the agent list, which shows which
channels an agent already serves and offers to add another, and the chat launcher, which offers
a messenger as a way to work with the agent. Both reach the modal built in 02.

Apply the `/react-ui-engineering` skill.

## Ask for the Figma frames first

- Agent list rows with channel chips — **view 21** (carries the overflow annotation)
- Agent list overflow menu, open — **view 22**
- Chat launcher tile grid, default and hover — **views 26, 27**

## Implementation plan

1. **Add channel chips to the agent list rows.** Figma uses the **row** layout, not the card
   variant the prototype offered as a toggle: name, size subtitle (`2 CPU · 2 Gi`), chips, status
   badge, `⋮`.

   One chip holds the messenger icon plus up to **two** comma-separated channel names, then
   `+N` for the remainder — per the annotation on view 21: *"When an agent is in multiple
   channels, we show 2 and hide the rest under a +# indicator."*

   Include **Telegram as well as Slack**. The prototype filters to Slack only; that is an
   omission, not a decision. Slack names come from sub-issue 01 and render as `#name`; Telegram
   titles come from the existing data and render **without** a `#`.

   An unresolved Slack name falls back to its raw id rather than vanishing.

2. **Add the two entries to the overflow menu**, between "Configure agent" and the lifecycle
   group, each with its messenger logo:

   ```
   Configure agent
   ─────
   Add to Slack channel
   Add to Telegram chat
   ─────
   Restart
   Pause — wakes on next use
   Stop — until started again
   ─────
   Delete agent
   ```

   Use exactly that wording. The prototype says "Add to **a** Telegram **channel**" and
   "Configure"; both are wrong against Figma.

   Each entry opens the modal from sub-issue 02 for that messenger alone. Show an entry only where
   that messenger is configured on the install.

3. **Rebuild the chat launcher as a tile grid.** Four tiles, two by two, each a bordered icon
   tile, a title and one line:

   | Tile | Description |
   |---|---|
   | Browser Terminal | Interactive session in this tab |
   | Local Terminal | SSH into the agent from your machine |
   | VS Code / Zed | Open workspace in your local editor |
   | Slack Channel | Mention the agent in a connected channel |

   **No Telegram tile.** The plan originally called for one alongside Slack. Built and reviewed
   2026-09-16: a fifth tile leaves an orphan on the last row of the 2×2 the design draws, and
   Slack is the capability this feature advertises. Telegram stays reachable from the setup
   Channels section, the agent-list overflow menu, and the agent's own Channels card, so nothing
   is lost. Figma draws four tiles; four it is.

   The messenger tiles open the modal from sub-issue 02. Drop the prototype's background gradient —
   Figma's tiles are flat.

   Tiles for unconfigured messengers do not appear. Keep the grid tidy when fewer than four show.

## Acceptance criteria

- [ ] Agent list rows show a chip per messenger, with at most two names and a `+N` remainder.
- [ ] Telegram bindings appear on the rows, titles without a `#`; Slack names show `#name`.
- [ ] A Slack channel whose name cannot be resolved falls back to its id.
- [ ] The overflow menu reads exactly as above, and each messenger entry opens the right modal.
- [ ] Menu entries and launcher tiles are absent for a messenger the install has not configured.
- [ ] The launcher is a 2×2 grid of the four tiles, flat, no gradient. No Telegram tile.
- [ ] The grid and the rows hold up at mobile width.
- [ ] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

```bash
mise run check && mise run test
```

On the local dev cluster, bind an agent to at least three Slack channels and one Telegram chat.
Confirm its list row shows two names plus `+1`, and the Telegram title with no `#`. Open the
overflow menu, choose "Add to Slack channel", and confirm the Slack modal opens; repeat for
Telegram. Open the agent in chat with no sessions yet and confirm the tile grid appears, that the
Slack and Telegram tiles open their modals, and that the other three tiles still work. Narrow to
mobile width and confirm nothing overflows.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
