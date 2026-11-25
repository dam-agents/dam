# 01 — Home: main actions in the header, fewer icons

**Part of:** The Home page is calmer and puts its main actions first — see [README](./README.md)

## Context

Home shows its two main actions, Browse starter kits and Create agent, in a row of their own between the Resources and Spend cards and the agent list, and it marks every usage figure with an icon.
This slice moves the actions onto the title's line, removes the Memory, Storage and CPU icons from the meters and the agent cards, gives the agent card's usage figures words instead, and draws the channel chips' Slack and Telegram logos in brand color at 16px.
The README's **Decisions** section fixes every visual choice; this file says where each one goes.

## Implementation plan

Apply `/react-ui-engineering` throughout.
All paths are under `packages/ui/src/`.

1. **Entry-point buttons into the header** — `modules/home/views/home-view.tsx`.
   - In the populated return (the last one), pass `actions={<EntryPointButtons />}` to `PageHeader`.
   - Delete the `<div className="mb-4 flex flex-wrap justify-end gap-2">` row that holds `EntryPointButtons` above `SandboxList`.
   - Leave the loading return (title alone) and the empty return (`WelcomeEntryPoints`, which calls `EntryPointButtons hero`) as they are.
   - `EntryPointButtons` itself does not change.
2. **No icon on the meters** — `modules/budgets/components/pool-bar.tsx`.
   - Remove the `icon` prop from `Props` and the destructuring, the `<Icon … />` element, and the `CarbonIconType` import.
   - Keep the title's `flex items-center gap-1.5` span: the warning sign still sits beside the title.
   - Remove `icon={RESOURCE_ICON.…}` and the `RESOURCE_ICON` import from `components/pool-usage.tsx` (Memory and Storage) and `components/cpu-row.tsx` (CPU).
3. **Words instead of icons on the agent card** — `modules/agents/components/usage-pairs.tsx`.
   - Replace the `icon` prop of `UsagePair` with the resource's word (`"memory"`, `"storage"`) and render `{amount} {word}` in place of the icon and the amount, for example `2.1 GB memory`.
   - Keep the `Tooltip`, its `what` text, the `tabIndex` and the `aria-label` (`${what}: ${amount}`) as they are.
   - Drop the `gap-1` from the span, since it no longer separates an icon; keep `tabular-nums`.
   - Remove the `CarbonIconType` and `RESOURCE_ICON` imports.
4. **Delete the icon map** — `modules/budgets/lib/resource-icons.ts` has no importer left after steps 2 and 3; delete the file.
   Confirm with `git grep -n resource-icons -- packages/ui` before deleting.
5. **Brand-color logos on the channel chips** — `modules/sandboxes/components/channels/agent-channel-chips.tsx`.
   - Give `MessengerChip` the logo component instead of `iconSlug`: `SlackColorIcon` for the Slack chip, `TelegramColorIcon` for the Telegram chip, both from `@/components/brand-icons`.
   - Render it at 16px (`className="size-4 shrink-0"`) with `aria-hidden`, since the chip's `title` and text carry the names.
   - Remove the `ConnectionIcon` import.
   - Do not change `ConnectionIcon` or any other Slack or Telegram mark; `connection-icon.test.ts` stays as it is.
6. Run `mise run check:comment-types`; no comment in the touched files names an icon after the change.
   `resource-icons.ts` takes its own `UNIT_BOUNDARY_DESCRIPTION` with it.

No architecture page names these icons or the place of the buttons (`budgets.md` § the resource card describes the bars, not their icons), and no QA journey or helper uses them, so no doc or profile changes in this slice.

## Acceptance criteria

- [x] The populated Home renders `EntryPointButtons` inside `PageHeader`'s `actions`, and nowhere else on the page.
- [x] The loading and empty states of Home are unchanged.
- [x] `PoolBar` has no `icon` prop, and the Resources card's three rows render no SVG before their titles.
- [x] An agent card's second line shows `<amount> memory` and `<amount> storage` with no icons, and a sleeping agent shows `<amount> storage` alone.
- [x] `modules/budgets/lib/resource-icons.ts` is gone, and nothing imports it.
- [x] The channel chips draw `SlackColorIcon` and `TelegramColorIcon` at 16px; every other Slack and Telegram mark in the app is unchanged.
- [x] `mise run //packages/ui:check`, `mise run //packages/ui:test` and `mise run check:comment-types` pass.

## Smoke test

Run the existing suite and checks:

```bash
mise run //packages/ui:check
```

```bash
mise run //packages/ui:test
```

```bash
mise run check:comment-types
```

`cpu-row.test.ts` renders `CpuRow` and asserts only its text and meter values, so it passes unchanged.

Then check by hand on the local cluster ([`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md)), steps 1–6 and 8 of the README's whole-feature smoke test.
The implementing agent runs these itself, then prints a short manual guide so the user can confirm the result by hand.
