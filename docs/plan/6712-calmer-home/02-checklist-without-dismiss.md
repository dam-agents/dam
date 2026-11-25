# 02 — Get started checklist without Dismiss

**Part of:** The Home page is calmer and puts its main actions first — see [README](./README.md)

## Context

The Get started popover ends in a footer with a Dismiss link.
Dismiss was the way to take the old floating pill off the page; since the checklist became a sidebar footer item, the popover's X, Escape and a click outside already close it, and Dismiss only adds a second close control that also hides the item until the next unlock.
This slice removes the link and its wiring from the UI, and updates the architecture page, the unit test and the QA journey that name it.
The dismissal itself stays an API capability: the server, the contract, `useSetChecklistDismissed` and every path that clears a dismissal are unchanged (README § Approach).

## Implementation plan

Apply `/react-ui-engineering` throughout.
UI paths are under `packages/ui/src/`.

1. **The panel** — `modules/getting-started/components/checklist-panel.tsx`.
   - Delete the footer `<div className="flex justify-end border-t border-border px-4 py-2">` with its Dismiss `<button>`.
   - Remove `onDismiss` from `Props` and from the destructuring.
   - The task list (`<ul>`) becomes the last section; keep its `border-t` and `py-1.5` so the popover's bottom edge stays as it is.
   - Rewrite the end of the `UNIT_BOUNDARY_DESCRIPTION`: drop the clause "Dismiss hides the checklist until the next unlock or the avatar picker".
2. **The nav item** — `modules/getting-started/components/getting-started-nav-item.tsx`.
   - Remove the `dismiss` function, the `onDismiss={dismiss}` prop, `const setDismissed = useSetChecklistDismissed();` and `useSetChecklistDismissed` from the import (keep `useMarkUnlockSeen`).
   - Keep `!checklist.dismissed` in `visible`, and keep the effect that drops the open flag when the item leaves: a dismissal made earlier, or through the API, still hides the item.
   - Rewrite the `UNIT_BOUNDARY_DESCRIPTION`: the close button, Escape and a click elsewhere close the popover back to the item; a checklist dismissed through the API stays hidden until the next unlock or until the avatar picker or the command palette asks for it; "another tab dismissed it" stays a reason the checklist can leave the page.
3. **Leave alone**: `hooks/use-open-checklist.ts` (it clears a dismissal, which still exists), `api/mutations.ts` (`useSetChecklistDismissed` keeps its caller there), `lib/derive-checklist.ts`, and everything under `packages/api-server*`.
4. **The unit test** — `src/__tests__/unit/getting-started-nav-item.test.ts`.
   - Delete the test "dismisses from the panel footer" and its `TEST_SCENARIO` line.
   - The nav item no longer calls `useSetChecklistDismissed`, so drop `setDismissed` from `fake` and `useSetChecklistDismissed` from the mutations mock if nothing else in the file uses them.
   - Add no test.
5. **The architecture page** — `docs/architecture/getting-started.md` § In the browser.
   - Change "A click elsewhere on the page, Escape, the popover's close button or its Dismiss closes it back to the item" to name only the click elsewhere, Escape and the close button.
   - Keep the sentence "A checklist dismissed through the API stays hidden until the next unlock …"; it is still true.
   - Bump `Last verified:` to the day of the change.
6. **The QA journey** — `.quality-inspector/qi-profile-dam/scenarios/get-started-checklist-in-the-sidebar.md`.
   - Delete AC-5 ("Dismiss hides the checklist until the next unlock"): no UI path dismisses the checklist any more.
   - Renumber AC-6, AC-7 and AC-8 to AC-5, AC-6 and AC-7; nothing else refers to these numbers.
   - In AC-2, add that the popover offers no other way to close than its close button, Escape and a click outside, so the journey still checks that Dismiss is gone.
7. Run `mise run fix:markdown` for the two Markdown files and `mise run check:comment-types` for the comments.

## Acceptance criteria

- [ ] The Get started popover renders no Dismiss control, and `ChecklistPanel` has no `onDismiss` prop.
- [ ] `GettingStartedNavItem` no longer calls `useSetChecklistDismissed`, and still hides the item while `progress.dismissed` is true.
- [ ] The avatar picker's "See how to unlock the rest" and the command palette still clear a dismissal and open the checklist.
- [ ] No file under `packages/api-server`, `packages/api-server-api` or `packages/db` changes.
- [ ] `getting-started.md` names no Dismiss control, keeps the API dismissal sentence, and has a new `Last verified:` date.
- [ ] The QA journey has no Dismiss criterion, its criteria are numbered AC-1 to AC-7, and AC-2 says how the popover closes.
- [ ] `mise run //packages/ui:check`, `mise run //packages/ui:test`, `mise run check:markdown` and `mise run check:comment-types` pass.

## Smoke test

Run the existing suite and checks:

```bash
mise run //packages/ui:test
```

```bash
mise run //packages/ui:check
```

```bash
mise run check:markdown
```

```bash
mise run check:comment-types
```

`getting-started-nav-item.test.ts`, `getting-started-drawer.test.ts` and `getting-started-open-checklist.test.ts` cover opening, closing, Escape, the drawer and the avatar-picker path, and pass without the deleted test.

Then check by hand on the local cluster ([`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md)), as a user who has not finished the checklist:

1. Click **Get started** in the sidebar footer; the popover ends with the task list, with no Dismiss link.
2. Close it with the X, then with Escape, then with a click on the page; each time the item stays in the footer.
3. Collapse the sidebar and repeat step 1 from the ring.

The implementing agent runs these itself, then prints a short manual guide so the user can confirm the result by hand.
