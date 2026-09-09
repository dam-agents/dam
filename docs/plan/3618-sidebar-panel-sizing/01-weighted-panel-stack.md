# 01 — Weighted panel stack for the chat sidebar

**Part of:** Chat sidebar panel sizing — see [README](./README.md)

## Context

Replace the chat sidebar's single-fixed-panel layout with a weighted stack: a persisted weight
per panel, a divider at every boundary between two open panels, and a drag limited only by the
neighbouring panel's minimum height. Everything is inside `packages/ui`; there is no server
side. Read the [README](./README.md) first — it holds the layout rule, the decisions behind it,
and the glossary this file assumes.

Apply the `/react-ui-engineering` skill while implementing.

## Implementation plan

### 1. Pure layout module

New file `packages/ui/src/modules/sessions/lib/sidebar-panels.ts`. No React, no DOM — all
functions take numbers and return numbers, so the logic is readable and reviewable on its own.

```ts
export const SIDEBAR_PANEL_IDS = ["sessions", "files", "artifacts"] as const;
export type SidebarPanelId = (typeof SIDEBAR_PANEL_IDS)[number];

export const MIN_PANEL_PX = 120;
export const COLLAPSED_PANEL_PX = 44;
export const DEFAULT_PANEL_WEIGHT = 1;

export type PanelWeights = Record<SidebarPanelId, number>;
```

Export three functions:

- `dividerPairs(panels: readonly { id: SidebarPanelId; open: boolean }[]): { above: SidebarPanelId; below: SidebarPanelId }[]`

  Walk the list in order, keep only the open panels, and emit one pair per consecutive couple.
  Collapsed panels are skipped, not treated as boundaries — that is what gives a divider to
  Sessions + Artifacts when Files is collapsed between them. Fewer than two open panels yields
  an empty list.

- `panelStyle(open: boolean, weight: number): CSSProperties`

  Open: `{ flexGrow: weight, flexBasis: 0, flexShrink: 1, minHeight: 0 }`.
  Collapsed: `{ flex: `0 0 ${COLLAPSED_PANEL_PX}px` }` — identical to today's behaviour.

- `resizePair(above: { weight: number; px: number }, below: { weight: number; px: number }, deltaPx: number): { above: number; below: number }`

  Clamp `deltaPx` into `[MIN_PANEL_PX - above.px, below.px - MIN_PANEL_PX]`, so neither panel of
  the pair drops below the minimum. That range can be empty when a panel already sits below the
  minimum because the window is short; clamp the low bound against the high bound so the result
  stays finite. Split the pair's combined weight by its new pixel ratio:

  ```
  totalPx     = above.px + below.px
  totalWeight = above.weight + below.weight
  aboveWeight = totalWeight * (above.px + delta) / totalPx
  belowWeight = totalWeight - aboveWeight
  ```

  Return the pair's weights only. The combined weight is preserved, so panels outside the pair
  keep their exact share and never jump mid-drag. Guard `totalPx <= 0` by returning the input
  weights unchanged.

Sanitise on read, not on write: treat a stored weight that is not finite or not `> 0` as
`DEFAULT_PANEL_WEIGHT`, so a hand-edited or half-written `localStorage` value cannot produce a
zero-height panel.

### 2. Stack hook

New file `packages/ui/src/modules/sessions/hooks/use-sidebar-panels.ts`.

```ts
export function useSidebarPanels(
  panels: readonly { id: SidebarPanelId; open: boolean }[],
): {
  panelProps: (id: SidebarPanelId) => {
    ref: RefCallback<HTMLDivElement>;
    style: CSSProperties;
    className: string | undefined;
  };
  dividerProps: (below: SidebarPanelId) => {
    onResize: (delta: number) => void;
    onDragEnd: () => void;
  } | null;
}
```

- **Weights.** One `useState<PanelWeights>` seeded from `readPersistedNumber` per panel, using
  keys `platform-panel-weight-sessions`, `platform-panel-weight-files`,
  `platform-panel-weight-artifacts`, each defaulting to `DEFAULT_PANEL_WEIGHT`. Mirror the state
  in a ref, the way `sessionsHRef` mirrors `sessionsH` today, so the drag handler reads the
  current value without re-subscribing on every frame. Write both weights of the pair with
  `writePersistedNumber` as the drag proceeds.
- **Element refs.** Keep a `Map<SidebarPanelId, HTMLDivElement | null>` in a ref and hand out a
  stable `RefCallback` per panel from `panelProps`. The refs are what `resizePair` measures.
  Memoise the callbacks per id so React does not detach and reattach the ref on every render.
- **Drag.** `dividerProps(below)` returns `null` unless `dividerPairs` contains a pair ending at
  `below`. Otherwise it returns handlers that, on each `onResize(delta)`, read both panel
  elements' `getBoundingClientRect().height`, call `resizePair`, then set state and persist. Two
  measurements per mouse-move event is fine at this scale, and measuring live is what keeps the
  arithmetic exact while `RuntimeOutdatedNotice` shares the column.
- **Transition suppression.** Own the `resizingSections` flag here: set it on the first
  `onResize`, clear it in `onDragEnd`. `panelProps().className` returns
  `"transition-[flex] duration-200"` when idle and `undefined` while dragging — the same values
  `sectionTransition` produces today. Without this the measured heights lag the weights and the
  drag fights the animation.

### 3. Rewire `chat-view.tsx`

In [`packages/ui/src/modules/sessions/views/chat-view.tsx`](../../../packages/ui/src/modules/sessions/views/chat-view.tsx):

- Delete `SESSIONS_HEIGHT_KEY` (line 109), the `sessionsH` / `sessionsHRef` state (lines
  193–196), `resizingSections` / `sectionTransition` (lines 197–200) and the `sectionFlex`
  helper (line 201). Drop any import left unused by the deletions.
- Call the hook once, driven by the three existing store flags:

  ```tsx
  const stack = useSidebarPanels([
    { id: "sessions", open: sessionsSectionOpen },
    { id: "files", open: filesSectionOpen },
    { id: "artifacts", open: artifactsSectionOpen },
  ]);
  ```

- In the sidebar column (lines 576–618), spread `stack.panelProps(id)` onto each panel in place
  of the current `className` and `style`, and render a divider **immediately before** each
  panel:

  ```tsx
  {(() => { const d = stack.dividerProps("files"); return d && <ResizeHandle orientation="vertical" {...d} />; })()}
  ```

  Pull that into a small local `Divider` component or a `renderDivider(id)` helper rather than
  repeating an IIFE three times. The existing hard-coded
  `{sessionsSectionOpen && filesSectionOpen && <ResizeHandle …>}` block at lines 588–603 goes
  away entirely — `dividerPairs` now decides.
- Leave the outer `ResizeHandle` at line 619 (the sidebar column's width) untouched. It is out
  of scope.

### 4. Thread `ref` through the panels

The hook measures each panel's root element, so all three panels must forward a ref. React 19 is
in use, so `ref` is a plain prop and `forwardRef` is not needed.

- [`sidebar-section.tsx`](../../../packages/ui/src/modules/sessions/components/sidebar-section.tsx):
  add `ref?: Ref<HTMLDivElement>` to the props and put it on the root `div` that already takes
  `className` and `style`.
- [`sessions-sidebar.tsx`](../../../packages/ui/src/modules/sessions/components/sessions-sidebar.tsx),
  [`files-panel.tsx`](../../../packages/ui/src/modules/files/components/files-panel.tsx) and
  [`chat-artifacts-panel.tsx`](../../../packages/ui/src/modules/artifacts/components/chat-artifacts-panel.tsx):
  add the same optional `ref` prop beside their existing `className` / `style` props and pass it
  to `SidebarSection`.

### 5. Clean up

Nothing writes `platform-sessions-h` any more. Leave the stale key in place; it is read by
nobody and clearing other origins' storage is not this change's job. Do not add a migration —
see the README's decisions.

## Acceptance criteria

- [ ] With all three panels open, a divider renders between Sessions and Files and between Files
      and Artifacts, and each drags space between just its own pair.
- [ ] With Sessions collapsed and Files and Artifacts open, a divider renders between Files and
      Artifacts and drags.
- [ ] With Files collapsed and Sessions and Artifacts open, exactly one divider renders, above
      the Artifacts header, and dragging it moves space between Sessions and Artifacts.
- [ ] With one or zero panels open, no divider renders.
- [ ] On a window tall enough to allow it, Sessions drags past 600px — the old fixed ceiling is
      gone.
- [ ] A drag stops when either panel of the pair reaches about 120px. Neither panel collapses,
      goes negative, or pushes the column into overflow.
- [ ] Collapsing a panel leaves the remaining open panels' ratio unchanged, and reopening it
      restores the share it had before.
- [ ] Sizes survive a page reload.
- [ ] A collapsed panel still renders as a 44px header, unchanged from today.
- [ ] `sectionFlex`, `sessionsH`, `sessionsHRef`, `resizingSections` and `SESSIONS_HEIGHT_KEY`
      no longer exist in `chat-view.tsx`.
- [ ] `mise run //packages/ui:check`, `mise run //packages/ui:test` and
      `mise run check:comment-types` all pass.

## Smoke test

Run the existing gates — no new test is authored:

```
mise run //packages/ui:check
mise run //packages/ui:test
mise run check:comment-types
```

Then check the behaviour by hand against the dev cluster. Rebuild and reload the UI first
(`mise run cluster:build-ui`; a stale bundle or service worker will otherwise serve the old
layout), open an agent's chat at `http://localhost:4444`, and walk the seven steps of the
README's **Whole-feature smoke test**. Steps 3, 4 and 7 are the ones that fail today, so they
are the ones that prove the change.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
