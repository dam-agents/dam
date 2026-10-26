# 01 — Keep the hidden labels inside the sidebar's scroll areas

**Part of:** Scrolling past the end of a conversation moves the whole app out of the window — see [README](./README.md)

## Context

The hidden "(unread)" labels in the classic sidebar have no positioned ancestor inside the sidebar's scroll areas.
So they make the page taller than the window in the chat view, and they hold hidden overflow in the frame of the other views.
This slice adds `relative` to the two classic-sidebar scroll areas, which is option A from the README.

## Implementation plan

Apply the `/react-ui-engineering` skill.

1. In `packages/ui/src/modules/platform/components/sidebar/sidebar-content.tsx`, add `relative` to the scroll area `div` with `data-testid="sidebar-sections"`.
   Its class becomes `relative -mx-2 mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-4`; let the formatter set the order.
2. In `packages/ui/src/modules/platform/components/sidebar/sidebar-flyout.tsx`, add `relative` to the scroll area `div` inside `PopoverContent` (today `min-h-0 overflow-y-auto`).
3. Change nothing else:
   - Keep the hidden labels and their text; the existing unit tests check "(unread)".
   - Do not touch the frame in `packages/ui/src/app.tsx`; option B makes the bug worse (README, "Options tested").
   - Do not add a code comment; the commit body says why.
4. Run `mise run //packages/ui:fix`, then `mise run check:comment-types`.

## Acceptance criteria

- [ ] In the chat view of the classic layout, with an unread Activity row below the bottom of the window, the page is exactly as tall as the window (`document.scrollingElement.scrollHeight === innerHeight`).
- [ ] In the chat view and on Home, scrolling the hidden label into view scrolls only the sidebar's scroll area; no element outside it gets a `scrollTop` above 0.
- [ ] In the Activity flyout of the collapsed rail, scrolling the hidden label into view scrolls the flyout's list.
- [ ] The sticky **Agents** and **Activity** headers still stick to the top of the sidebar while it scrolls.
- [ ] The row action buttons, the drag drop indicator and the filter button's dot show at the same places as before.
- [ ] `mise run //packages/ui:test` and `mise run check` pass.

## Smoke test

Run the UI from this branch against the local cluster.
Use the worktree's dev server on port 5173 if that port is free (Keycloak allows only that port for the dev server).
Otherwise run `mise run cluster:build -- ui`, and tell the user first, because it replaces the UI for every session on the shared cluster.

Sign in, keep `new-layout` off, and use a short window (for example 1024 × 768).
Make sure at least one unread session sits in the Activity list below the bottom of the window.
Then paste this probe into the browser console in each of three places: a session (chat view), Home, and the open Activity flyout of the collapsed rail.

```js
(() => {
  const label = [...document.querySelectorAll(".sr-only")].find((e) => e.textContent === "(unread)");
  const ancestors = [];
  for (let e = label.parentElement; e; e = e.parentElement) ancestors.push(e);
  const pageHeight = document.scrollingElement.scrollHeight;
  label.scrollIntoView({ block: "nearest" });
  const moved = ancestors.filter((e) => e.scrollTop > 0).map((e) => e.dataset.testid ?? e.className);
  return { pageHeight, windowHeight: innerHeight, scrollY, moved };
})();
```

Expected result:

- `pageHeight` equals `windowHeight`, and `scrollY` is 0.
- `moved` lists only the sidebar's scroll area (`sidebar-sections`), or the flyout's scroll area (`min-h-0 overflow-y-auto`) for the flyout.
- Before the fix, the chat view gives a `pageHeight` above `windowHeight` and a `scrollY` above 0, and Home lists the frame (`flex flex-col h-dvh … relative overflow-hidden`) in `moved`.

Then walk the README's whole-feature smoke test with the mouse wheel.

After the run, print a short manual guide for the user: the three places to check, the wheel scrolls of AC-1 to AC-3, and what each one must show.
