# 04 — Sandbox configuration is visible in chat and reachable from the list

**Depends on:** [01-rows-open-chat](./01-rows-open-chat.md)
**Part of:** one-click chat from the sandbox list — see [README](./README.md)

## Context

Covers [#3070](https://github.com/dam-agents/dam/issues/3070). Once the row click opens chat,
the chat header's ⋮ menu becomes the main route to configuration — and on desktop that ⋮ is
invisible until you hover the sandbox name, so nothing says it is there. This slice makes it
always visible, and puts "Configure sandbox" on the list row's own ⋮ menu so the
configuration page is still one click from where it used to be the landing.

Figma: https://www.figma.com/design/zNIYydUKN1QLZDYozpQJpn/DAM-DEV?node-id=1869-3286

## Implementation plan

1. **Always-visible kebab in chat** — `packages/ui/src/modules/sessions/views/chat-view.tsx`:
   the header's `DropdownMenuTrigger` button carries `className={HOVER_ACTION}` (~line 496).
   Drop it, and drop the `HOVER_ACTION` import if this is its last use in the file. The
   wrapping `div` keeps its `group` class for the name's own hover styling.

2. **"Configure" on the list row** —
   `packages/ui/src/modules/agents/components/agent-row.tsx`: add a first item to the
   `DropdownMenuContent`, above the power actions, driven by two new props:

   ```ts
   /** Route to this row's configuration page, labelled for its surface. */
   onConfigure: () => void;
   configureLabel: string;
   ```

   Render it as `<DropdownMenuItem onSelect={onConfigure}>{configureLabel}</DropdownMenuItem>`
   followed by a `DropdownMenuSeparator`, so configuration reads apart from the lifecycle
   actions rather than among them.

3. **Wire both surfaces** — `AgentRow` is shared, so each view supplies its own wording and
   destination:

   - `packages/ui/src/modules/agents/views/list-view.tsx`: `configureLabel="Configure sandbox"`,
     `onConfigure={() => navigateToSandboxHome(agent.id)}` — re-add the store selector this
     view dropped in slice 01.
   - `packages/ui/src/modules/knowledge-bases/views/knowledge-bases-list-view.tsx`:
     `configureLabel="Configure knowledge base"`,
     `onConfigure={() => navigateToKnowledgeBaseConfig(agent.id)}`. The KB surface speaks in
     knowledge-base terms, matching what the chat header already does there.

4. Run `mise run ui:fix`.

## Out of scope, deliberately

The experiments list groups its sandboxes under a bare section header
(`modules/experiments/components/sandbox-group-card.tsx`) with an "Open sandbox →" affordance
and no ⋮ menu at all. Adding one would mean inventing a control that card does not have. Its
sandbox is one click from chat, where step 1 makes the ⋮ permanently visible — so the
issue's "consistent across sandboxes, experiments, and knowledge bases" is met by the chat
header for that surface. Flag it to the user rather than growing the card.

## Acceptance criteria

- [ ] The chat header's ⋮ is visible without hovering, on desktop and mobile alike.
- [ ] The Home row ⋮ menu opens with "Configure sandbox" first, separated from Wake/Restart/Pause/Stop/Delete, and it reaches `/sandboxes/<id>`.
- [ ] The knowledge-base row ⋮ menu reads "Configure knowledge base" and reaches the KB config page.
- [ ] Clicking the ⋮ still does not trigger the row's own click — the existing `stopPropagation` wrapper covers the new item.
- [ ] `mise run --force ui:check` and `mise run --force ui:test` pass.

## Smoke test

```
mise run --force ui:check
mise run --force ui:test
```

Then by hand on `localhost:5173`:

1. Open a chat and move the pointer nowhere near the sandbox name → the ⋮ is there.
2. On Home, open a row's ⋮ → "Configure sandbox" lands on the config page; the row itself
   did not navigate to chat on the way.
3. Same on a knowledge-base row → "Configure knowledge base" lands on its config page.

The implementing agent runs the commands itself, then prints this manual guide for the user
to confirm by hand.
