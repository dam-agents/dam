# 03 — `+ New` opens a chat session directly

**Depends on:** [02-launch-options](./02-launch-options.md)
**Part of:** one-click chat from the sandbox list — see [README](./README.md)

## Context

`+ New` in the sessions sidebar opens a menu asking whether you want a chat or a terminal
session. Chat is the answer nearly every time, and since 02 put the terminal buttons in the
new-session state, the menu asks a question whose other answer is now one click away on the
page it opens. The button does the common thing instead.

Reference: `screens/DAM-1.png` shows `+ New` as a plain button.

## Implementation plan

1. `packages/ui/src/modules/sessions/components/sessions-sidebar.tsx`:

   - In `headerRight`, replace the second `DropdownMenu` (trigger plus the two
     `DropdownMenuItem`s) with the trigger's own button wired straight to `onNewSession`:
     `<Button variant="outline" size="xs" className="text-sm" onClick={onNewSession}><Add size={12} /> New</Button>`.
   - Remove the `onNewTerminal` prop from the component's props type and signature.
   - `DropdownMenuItem` becomes unused (the filter menu uses `DropdownMenuCheckboxItem`) —
     drop it from the import.

2. `packages/ui/src/modules/sessions/views/chat-view.tsx`: stop passing `onNewTerminal` to
   `<SessionsSidebar>`. Keep `handleNewTerminal` — `NewSessionLauncher` is its caller now.

3. Leave `handleNewSession` alone. Its existing early return (already-blank chat → just show
   the chat pane) is the right response to a repeated click.

4. Run `mise run ui:fix`.

## Acceptance criteria

- [ ] `+ New` opens a blank chat session immediately, with no menu.
- [ ] Pressing `+ New` on an already-blank chat is a no-op beyond focusing the chat pane (and on mobile, switching to it).
- [ ] A browser terminal is still reachable in two clicks: `+ New`, then Terminal (browser).
- [ ] `SessionsSidebar` no longer takes `onNewTerminal`, and no dead imports remain.
- [ ] `mise run --force ui:check` and `mise run --force ui:test` pass.

## Smoke test

```
mise run --force ui:check
mise run --force ui:test
```

Then by hand on `localhost:5173`: with a session open, click `+ New` → the pane blanks to the
new-session state in one click. Click `+ New` again → nothing jarring happens. From there
click Terminal (browser) → a terminal opens.

The implementing agent runs the commands itself, then prints this manual guide for the user
to confirm by hand.
