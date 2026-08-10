# 02 — Launch options in the new-session state

**Depends on:** [01-rows-open-chat](./01-rows-open-chat.md)
**Part of:** one-click chat from the sandbox list — see [README](./README.md)

## Context

With chat as the landing, the other ways into a sandbox need a home. They move to the
new-session state, beside the message box: **Terminal (browser)**, **Terminal (local)**,
**Vs Code / Zed (local)**. The "Open in" menu on the sandbox configuration page then has
nothing left to offer — its chat item is the page you came from — so it goes.

Reference: `screens/DAM-1.png` (the row), `DAM-5.png` / `DAM-7.png` / `DAM-2.png` (the three
buttons hovered), `DAM-4.png` (terminal dialog), `DAM-3.png` (editor dialog).

## Implementation plan

1. **Extract the dialogs** — new
   `packages/ui/src/modules/sandboxes/components/open-in-dialogs.tsx`. Move
   `CliQuickstartNote`, `OpenInTerminalDialog`, and `OpenInIdeDialog` verbatim out of
   `open-in-menu.tsx` and export the two dialogs. Change their props from
   `{ agent: AgentView }` to `{ agentId: string; agentName: string; onClose: () => void }` —
   the chat view has `selectedAgent` and `selectedAgentName`, not necessarily a loaded
   `AgentView`. Substitute `agentId` where the commands interpolate `agent.id` and
   `agentName` where the subtitle names the sandbox. Retitle the editor dialog
   `"Open in VS Code / Zed"` (the mockup's wording, in the product's casing).

2. **New launcher component** — `packages/ui/src/modules/sessions/components/new-session-launcher.tsx`:

   - Props `{ agentId: string; agentName: string; onNewTerminal: () => void }`.
   - Local `useState<"terminal" | "ide" | null>` for the open dialog — nothing here is
     shared, so it stays local.
   - A centred row of three `Button variant="outline"` controls matching the mockup order:
     `Terminal` icon + "Terminal (browser)" → `onNewTerminal`; `Terminal` icon +
     "Terminal (local)" → open the terminal dialog; `Code` icon + "Vs Code / Zed (local)" →
     open the editor dialog. Icons from `@carbon/icons-react`.
   - Render the two dialogs from `../../sandboxes/components/open-in-dialogs.js`, closing on
     `onClose`.

3. **Wire it into the empty chat state** — `chat-view.tsx`, the `messages.length === 0`
   branch's non-`launchPaneActive` side (~line 664). Heading becomes
   `Start a new session`; the line under it becomes
   `Send a message to begin or open a new session in:`. Below it, render
   `<NewSessionLauncher …/>` when `selectedAgent && !isKnowledgeBaseView` — the
   knowledge-base surface keeps its own copy and gets no launcher. Pass
   `agentName={selectedAgentName ?? ""}` and `onNewTerminal={handleNewTerminal}`
   (the callback already exists in this file). Leave the `launchPaneActive` branch untouched.

4. **Replace the menu on the configuration header** —
   `packages/ui/src/modules/sandboxes/components/sandbox-home-header.tsx`: remove the
   `<OpenInMenu agent={agent} />` element and its import (issue scope item 3), and put a single
   primary `Open chat` button in its place, calling `selectAgent(agent.id)`. The four-item
   menu no longer earns its keep — its chat item is the one route anybody wants from here, and
   the other three now live in the new-session state that button lands on. This matches the
   knowledge-base config page, which already carries one "Open knowledge base" button.

5. **Delete** `packages/ui/src/modules/sandboxes/components/open-in-menu.tsx`. Confirm with a
   repo-wide grep that `OpenInMenu` has no other importer before deleting.

6. Run `mise run ui:fix` — it reorders imports and normalises `import type`.

## Acceptance criteria

- [ ] The empty chat reads "Start a new session" / "Send a message to begin or open a new session in:" with the three buttons beneath, in the mockup's order.
- [ ] **Terminal (browser)** opens a fresh terminal session in the chat pane — the same behavior the sidebar's "New terminal session" item has today.
- [ ] **Terminal (local)** shows the "Open in Terminal" dialog with a working Copy on `dam chat <agentId>`.
- [ ] **Vs Code / Zed (local)** shows the "Open in VS Code / Zed" dialog with both `dam ssh connect -x code|zed <agentId>` commands and their Copy buttons.
- [ ] Both dialogs name the open sandbox in their subtitle and link the CLI quickstart.
- [ ] The knowledge-base chat's empty state shows no launcher row.
- [ ] The pending-launch ("Starting the run…") empty state is unchanged.
- [ ] The sandbox configuration page header has no "Open in" menu; it carries an "Open chat" button that lands in chat, and its ⋮ menu still works.
- [ ] `open-in-menu.tsx` is gone and nothing imports it.
- [ ] `mise run --force ui:check` and `mise run --force ui:test` pass.

## Smoke test

```
mise run --force ui:check
mise run --force ui:test
```

Then by hand on `localhost:5173`:

1. Open a running sandbox with no open session → the three buttons are there. Click each:
   the browser one gives a terminal in the pane, the two local ones give dialogs whose Copy
   puts the command on the clipboard.
2. Open a knowledge base from its list → the empty state has no launcher row.
3. Chat header ⋮ → "Configure sandbox" → the header shows only the ⋮ menu.

The implementing agent runs the commands itself, then prints this manual guide for the user
to confirm by hand.
