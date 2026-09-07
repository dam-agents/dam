# 01 — List row: visible share controls, badge as control

**Part of:** Make artifact sharing visible — see [README](./README.md)

## Context

An artifact row hides both of its share controls behind a hover reveal, so at
rest the user sees no way to share. This slice makes the row's share controls
visible at rest and turns the `Public`/`Private` badge into the control that
opens the share dialog. Because
[`sandbox-artifacts-section.tsx`](../../../packages/ui/src/modules/artifacts/components/sandbox-artifacts-section.tsx)
renders the same `ArtifactRow`, a sandbox's home list inherits all of it.

Read the Approach and Decisions sections of the [README](./README.md) first —
in particular that `HOVER_ACTION` itself must not change, and that
`artifact.shareUrl` is the public flag.

## Implementation plan

Apply the `/react-ui-engineering` skill throughout.

### 1. Let `Badge` render as a different element

[`packages/ui/src/components/ui/badge.tsx`](../../../packages/ui/src/components/ui/badge.tsx)

Add an optional `asChild` prop, exactly as
[`button.tsx`](../../../packages/ui/src/components/ui/button.tsx) already does
it: import `Slot` from `@radix-ui/react-slot` (already a dependency) and use
`const Comp = asChild ? Slot : "span"`.

This is purely additive — no existing `Badge` call site changes behaviour. It
lets the status badge *be* a real button rather than a `<span>` wrapped in one,
so the `focus:ring-2 focus:ring-ring` rules already in `badgeVariants` apply to
the focusable element instead of being dead.

If `asChild` turns out to be awkward, the fallback is to wrap the `<Badge>` in a
`<button>` at the call site in step 2 and move the focus ring onto the wrapper.
Prefer `asChild`.

### 2. Make `ArtifactStatusBadge` optionally interactive

[`packages/ui/src/modules/artifacts/components/artifact-badges.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-badges.tsx)

- **Drop the `Deleting soon` branch** (currently the first branch, taking
  precedence over visibility). The badge must always report `Public` or
  `Private`, or an expiring artifact would have no share control. Retention
  stays visible in the row's own countdown, rendered a few lines up in
  `artifact-row.tsx`.
- Remove the now-unused `deletionState` import from `../lib/format.js`, or lint
  will fail.
- Add an optional `onShare?: (artifact: LibraryArtifact) => void` prop. When it
  is **absent**, render exactly what the component renders today (a plain
  `<span>`) — slice 02 needs this non-interactive form for the preview toolbar.
  When it is **present**, render the badge as a button:
  - `<Badge asChild …><button type="button" aria-haspopup="dialog" onClick={() => onShare(artifact)}>…</button></Badge>`
  - Wrap it in `<Tooltip content="Sharing settings…">` from
    [`@/components/ui/tooltip`](../../../packages/ui/src/components/ui/tooltip.tsx).
  - Add a hover affordance and `cursor-pointer` via `className`. The `muted` and
    `success` variants have no hover style of their own, so without this the
    badge gives no sign that it is pressable — which is the whole point of the
    slice. Use existing tokens; do not introduce new colours.
  - The accessible name stays the visible text (`Private` / `Public`);
    `aria-haspopup="dialog"` is what tells a screen-reader user it opens
    something. Do not add an `aria-label` that hides the state.

This component has exactly one call site today, so the change is contained.

### 3. Rewrite the row's action cluster

[`packages/ui/src/modules/artifacts/components/artifact-row.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-row.tsx),
the `ml-auto` block near the end of `ArtifactRow`.

Target order, matching the frames, left to right: **Copy link** → status badge →
three-dots.

- **Remove `HOVER_ACTION` from the inner wrapper's `className`.** Keep the
  wrapper element and keep its `onClick={(e) => e.stopPropagation()}` — the row
  itself is clickable and opens the preview. Do **not** edit
  [`hover-action.ts`](../../../packages/ui/src/components/ui/hover-action.ts);
  the other eight call sites must keep hover-only behaviour.
- **Move `ArtifactStatusBadge` inside that wrapper.** It currently sits outside
  the `stopPropagation` boundary. Now that it is a button, leaving it outside
  would open the share dialog *and* the preview on one click.
- Pass `onShare` to the badge.
- Merge the wrapper's spacing so all three children sit in one row with an even
  gap; today the outer element uses `gap-2` and the inner one `gap-0.5`.

### 4. Turn `ShareLinkButton` into a copy-only, labelled button

Same file, the `ShareLinkButton` helper at the bottom.

- Rename it to `CopyLinkButton` and drop its `onShare` prop. It no longer opens
  the share dialog — the badge does that now — so its dual-purpose branch on
  `artifact.shareUrl` disappears.
- Render it in step 3 **only when `artifact.shareUrl` is set**. A private row
  shows no copy control at all; the frames confirm this.
- Give it the visible label `Copy link` beside the `Link` icon. In the row the
  frames show it borderless, so use `variant="ghost"` at a size that matches the
  row's text rhythm.
- Keep the existing copied state as it is: the icon swaps to `Checkmark` and the
  tooltip reads `Copied!`. Do not change the visible label on copy — post-copy
  feedback is #3064 and out of scope.
- Keep `useCopy` and `toastCopyOutcome`. Write no new clipboard handling.

### 5. Leave the overflow menu alone

[`artifact-row-menu-items.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-row-menu-items.tsx)
keeps its **Share** item. It is the accessible, conventional path for users who
would not think to click a status badge, and it is the chat sidebar's only share
entry point. **This file is not edited in this slice.**

## Acceptance criteria

- [ ] With the pointer away from any row, a private row shows a `Private` badge
      and the three-dots button; a public row also shows a labelled **Copy
      link**.
- [ ] Clicking either the `Private` or the `Public` badge opens the share dialog
      and does **not** open the preview dialog.
- [ ] Clicking the row anywhere outside the action cluster still opens the
      preview.
- [ ] **Copy link** is absent on a private row and copies the share URL on a
      public one, with the `Checkmark` state intact.
- [ ] The badge is reachable and operable by keyboard, shows a visible
      focus ring, and announces the visibility state as its name.
- [ ] An artifact with a delete-after date shows `Public`/`Private` on the
      badge, and its retention countdown still renders in the row's meta line.
- [ ] `HOVER_ACTION` is unchanged and the files and sessions rows still reveal
      their actions on hover only.
- [ ] `artifact-row-menu-items.tsx` is not modified and still offers **Share**.
- [ ] `mise run ui:check`, `mise run ui:test` and
      `mise run common:check:comment-types` all pass.

## Smoke test

```bash
mise run ui:check ::: mise run ui:test ::: mise run common:check:comment-types
```

Then, by hand:

```bash
mise run ui:run
```

Open the URL Vite prints — confirm the port, because another worktree may
already own 5173. Log in and go to **Artifacts**. With the mouse parked away
from the list, check that a private row shows its badge and three-dots, and a
public row also shows **Copy link**. Click the `Private` badge: the share dialog
opens and the preview does not. Enable the public link, Save, and confirm the
row flips to `Public` with **Copy link** appearing. Click **Copy link** and paste
the clipboard somewhere to confirm the URL. Then tab to the badge with the
keyboard and press Enter. Finally open a sandbox's home view and repeat the
at-rest check on its Artifacts section.

The implementing agent runs this itself, then prints a short manual smoke-test
guide so the user can confirm it by hand.
