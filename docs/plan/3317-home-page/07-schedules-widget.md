# 07 — Schedules widget

**Depends on:** 06-owner-wide-schedule-list
**Part of:** A Home page — see [README](./README.md)

## Context

The third block in Home's right-hand column: the user's schedules across every sandbox, with the top
five inline, a "See all" modal over the rest, working enable/disable toggles, and inline create and
edit. Slice 06 supplies the owner-wide list; everything the widget does to a schedule already exists
as a mutation.

Apply the `/react-ui-engineering` skill.

## Implementation plan

### 1. Read what exists first

`modules/schedules/` already owns all of this for the sandbox-level panel:

- `components/schedules-panel.tsx`, `components/schedule-card.tsx`, `components/schedule-details.tsx`
- `forms/schedule-form-modal.tsx`, `forms/schedule-form-schema.ts`, `forms/quiet-hours-editor.tsx`
- `lib/schedule-format.ts`, `lib/schedule-lock.ts`, `lib/schedule-form-options.ts`
- `api/mutations.ts`: `useToggleSchedule`, `useCreateSchedule`, `useUpdateSchedule`,
  `useDeleteSchedule`, `useResetScheduleSession`

The widget composes these, it does not reimplement them. In particular `schedule-form-modal.tsx` is
the create/edit form — reuse it rather than writing a second one, and `lib/schedule-lock.ts` plus
`components/schedule-lock-notice.tsx` exist because some schedules cannot be edited; that rule must
hold on Home too.

### 2. The widget — `modules/home/components/schedules-widget.tsx`

Structure from the prototype's `ScheduledSection`. The compact list shows five, sorted as slice 06
returns them, each with its sandbox named — on Home a schedule without its sandbox is ambiguous, which
is not true in the per-sandbox panel.

Use `lib/schedule-format.ts` for the cadence and next-run text. Do not format a cron expression or an
RRULE by hand.

### 3. Toggle

`useToggleSchedule` from the existing mutations. The toggle must reflect the server result rather than
just local state — slice 06 requires the mutations to invalidate the owner-scoped key, so confirm that
landed; if the toggle flips back after a refetch, that invalidation is missing.

Respect the lock: a locked schedule shows the notice rather than a toggle that fails.

### 4. "See all" modal

The full list, over the same data. If slice 06's procedure takes a limit, the modal asks for the
unbounded list; do not fetch everything up front to render five.

Reuse `schedules-panel.tsx` inside the modal if it fits without contortion — it already renders a full
schedule list with its actions. If it assumes a single agent, prefer extracting the list portion over
forking it, and note in your report what you extracted.

### 5. Inline create and edit

Open `forms/schedule-form-modal.tsx` from the widget. Creating from Home needs a target sandbox that
the per-sandbox flow gets for free — take it from the prototype's `HomeCreateScheduleModal`, which
solves exactly this, and make the sandbox an explicit field.

### 6. Empty state

No schedules at all: say what a schedule is for and offer to create one. Do not render an empty block.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test` and `--force common:check:comment-types` pass.
- [ ] The widget lists up to five schedules across all the user's sandboxes, each naming its sandbox.
- [ ] Enable/disable persists across a refetch and a reload.
- [ ] Opening a locked schedule shows its lock notice instead of the form. The toggle is not lock-gated — the per-agent card does not gate it either, and matching the app beats matching this plan.
- [ ] "See all" opens the full list with its actions available.
- [ ] Create from Home requires a target sandbox and round-trips; edit round-trips.
- [ ] Cadence and next-run text come from `lib/schedule-format.ts`.
- [ ] The sandbox-level schedules panel still works unchanged.
- [ ] With no schedules, the widget explains itself rather than rendering empty.

## Smoke test

```sh
mise run --force ui:check
mise run --force ui:test
```

Then on the dev server at `localhost:5173`, with two sandboxes:

1. Create a schedule on each from their sandbox pages, then confirm both appear in the Home widget
   with their sandbox names.
2. Toggle one off, reload, and confirm it is still off.
3. Create six or more schedules and confirm the widget shows five and "See all" shows the rest.
4. Create a schedule from Home, choosing its sandbox, and confirm it appears on that sandbox's own
   panel too.
5. Edit one from Home and confirm the change lands.
6. Delete them all and confirm the widget's empty state.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
