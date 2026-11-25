# The Home page is calmer and puts its main actions first

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/6712

## Goal

A design review in the 0.3.0 QA found that Home is visually noisy and hides its main actions halfway down the page.
After this change, a person who opens Home sees **Browse starter kits** and **Create agent** on the same line as the **Home** title.
The usage meters and the agent cards carry no Memory, Storage or CPU icons, so the page shows fewer marks.
An agent card's Slack and Telegram chips show the messengers' own logos in brand color, so a person sees at a glance where an agent talks.
The Get started checklist has one way to close it, its X, because the Dismiss link no longer has a job.

## Approach

All of it is in `packages/ui`; no API, contract or database changes.

- **Home view** — [`modules/home/views/home-view.tsx`](../../../packages/ui/src/modules/home/views/home-view.tsx) renders the populated Home.
  `PageHeader` ([`components/ui/page-header.tsx`](../../../packages/ui/src/components/ui/page-header.tsx)) already has an `actions` slot that sits on the title's line from the `@lg` container width and wraps below the title on a narrow screen.
  The two buttons come from `EntryPointButtons` ([`modules/agents/components/entry-point-buttons.tsx`](../../../packages/ui/src/modules/agents/components/entry-point-buttons.tsx)), which also records the entry-point choice; the buttons move, their behavior does not.
- **Resource icons** — one map, `RESOURCE_ICON` in [`modules/budgets/lib/resource-icons.ts`](../../../packages/ui/src/modules/budgets/lib/resource-icons.ts), gives the icon to the three meters of the Resources card (`PoolBar` through `PoolUsage` and `CpuRow`) and to the agent card's usage pairs (`UsagePairs`).
  Removing the icons removes the map and the `icon` prop of `PoolBar`.
- **Channel chips** — `AgentChannelChips` ([`modules/sandboxes/components/channels/agent-channel-chips.tsx`](../../../packages/ui/src/modules/sandboxes/components/channels/agent-channel-chips.tsx)) draws the chips on the agent card and on the bind-picker card.
  It uses `ConnectionIcon`, which draws every Slack and Telegram mark in `currentColor`; that rule stays for every other place.
  The color marks already exist as `SlackColorIcon` and `TelegramColorIcon` in [`components/brand-icons.tsx`](../../../packages/ui/src/components/brand-icons.tsx), used at 16–18px by the new-session launcher, the Welcome hero and the empty Artifacts page.
- **Get started checklist** — [`docs/architecture/getting-started.md`](../../architecture/getting-started.md) § In the browser.
  The checklist moved from a floating corner pill, which covered page content, to a sidebar footer item whose popover opens only on a click.
  The Dismiss link was there to take the pill off the page; in the popover it is a second close control that differs from the X only in that it also hides the footer item until the next unlock.
  The dismissal stays an API capability ("a checklist dismissed through the API"): the server field, `gettingStarted.setDismissed`, and the two paths that clear a dismissal (the next unlock, and `useOpenChecklist` from the avatar picker and the command palette) are unchanged.

No Figma frame exists for this issue.
The visual decisions below were proposed in the planning conversation and accepted; each reuses an existing primitive and adds no new size, color or icon.

### Decisions

- **Header actions** go into `PageHeader`'s `actions` slot in the populated state only.
  The empty state keeps the Welcome hero and its own large buttons; the loading state keeps the title alone.
  `Button`'s default height (40px) equals the header's `min-h-10`, so the header does not grow when the buttons appear.
  The buttons keep their order (Browse starter kits, then Create agent) and their Gift and Add icons; the issue removes only the resource icons.
- **Agent card usage** reads `2.1 GB memory · 4 GB storage`: number first, a lowercase word after it.
  A sleeping agent shows storage alone, so a bare number could not say which resource it is.
  DAM already writes amounts this way (`user-budget-copy.ts`: `8 GiB memory · 20 GiB storage`).
  The tooltip and the accessible name stay as they are.
- **Meters** keep their titles (Memory, Storage, CPU) as text; only the icon in front of each title goes.
- **Brand-color logos** apply to the channel chips only, at 16px, which leaves the 20px chip height unchanged because the chip's `text-xs` line is 16px high.
  Menus, channel cards, connection rows and the command palette keep monochrome marks, because they follow hover, active and disabled text colors; `connection-icon.test.ts` keeps asserting that.
- **Dismiss** leaves the UI only.
  An earlier dismissal still hides the item until the next unlock, or until the user opens the checklist from the avatar picker or the command palette.

## Sub-issues

| #     | Title                                         | Scope                                                                                                                | Depends on |
| ----- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------- |
| 01 ✅ | Home: main actions in the header, fewer icons | Entry-point buttons into the Home header; resource icons removed from meters and agent cards; color logos on chips.  | —          |
| 02    | Get started checklist without Dismiss         | Remove the Dismiss link and its wiring; update the architecture page, the unit test and the QA journey that name it. | —          |

The two slices touch different files and do not depend on each other; implement 01 first.

## Conventions & glossary

- **Agent card** — `AgentRow` ([`modules/agents/components/agent-row.tsx`](../../../packages/ui/src/modules/agents/components/agent-row.tsx)), one per agent in Home's list.
- **Usage meters** — the Memory, Storage and CPU bars of the Resources card on Home.
- **Channel chip** — a muted `Badge` on an agent card that names the Slack channels or Telegram chats the agent is in.
- **Entry-point buttons** — Browse starter kits and Create agent.
- Words follow [`docs/ubiquitous-language.md`](../../ubiquitous-language.md): the thing a person owns is an **agent**.
- Apply `/react-ui-engineering` to every change in `packages/ui`.
- Code comments follow [`docs/guidelines/comment-guidelines.md`](../../guidelines/comment-guidelines.md); run `mise run check:comment-types` after each slice.
- No new tests (see the slices for the tests that change or go).

## Whole-feature smoke test

On the local cluster ([`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md)), with a user who owns at least one running agent, one sleeping agent, and one agent in a Slack channel or a Telegram chat:

1. Open Home at a desktop width.
   **Browse starter kits** and **Create agent** sit at the right end of the **Home** title's line; nothing sits between the Resources and Spend cards and the agent list.
2. Narrow the window to a phone width.
   The two buttons wrap below the title and stay usable.
3. Click **Browse starter kits**: the kit browser opens.
   Click **Create agent**: a new agent is created, as before.
4. In the Resources card, the Memory, Storage and CPU rows show their titles without icons; warnings, tooltips and segment clicks work as before.
5. On the running agent's card the second line reads `… · <n> memory · <n> storage`; on the sleeping agent's card it reads `… · <n> storage`.
6. The agent in a channel shows its chip with the Slack (four-color) or Telegram (blue disc) logo at 16px, in light and dark themes.
   The Slack and Telegram marks in the sidebar agent menu and the channel cards are still monochrome.
7. Open **Get started** in the sidebar footer.
   The popover has no Dismiss link; the X, Escape and a click outside close it, and the item stays in the footer.
8. Switch the theme between light and dark and repeat steps 1, 5 and 6.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/6712.
The PR changes what the web UI shows, so it carries before and after screenshots of Home (light and dark) and of the checklist popover, uploaded with `gh pr edit --attach`.
