# Scrolling past the end of a conversation moves the whole app out of the window

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/5841 (the fix also closes https://github.com/dam-agents/dam/issues/5092)

## Goal

In the classic layout, the chat view must always fill the window.
Only its panels scroll, and each panel stops at its last item.
Today, unread sessions in the sidebar's Activity list make the page taller than the window.
A scroll that reaches the end of a panel then moves the whole app up and out of the window.
The same cause makes the page height jump when a longer session list pushes the Activity list down, which is #5092.

## Acceptance criteria

### AC-1 — the app stays in the window at the end of a conversation

Given the owner signed in on a desktop browser, with the sidebar open, unread sessions in its Activity list below the bottom of the window, and a session with a short conversation open
When the owner scrolls down over the conversation with the mouse wheel
Then the top bar, the top of the sidebar and the message box stay where they were

### AC-2 — the sidebar stops at its last item

Given the same window
When the owner scrolls down over the sidebar past its last item
Then the sidebar stops at its last item and the rest of the app does not move

### AC-3 — View more does not let the page move

Given the same window, with an agent open in the sidebar that has more sessions than its list shows, and View more clicked in that agent's list
When the owner scrolls down over the conversation with the mouse wheel
Then the top bar, the top of the sidebar and the message box stay where they were

## Approach

### Cause

All numbers below come from the local cluster on 2026-10-26, in a 1024 × 768 window, with `new-layout` off.

- Each unread row in the classic sidebar's Activity list carries a hidden label for screen readers: `<span className="sr-only">(unread)</span>` in `packages/ui/src/modules/home/components/sidebar-activity-row.tsx`.
- Tailwind's `sr-only` sets `position: absolute`.
- The browser places an absolute element against its nearest positioned ancestor, its **containing block**.
- A scroll area clips and scrolls only the content whose containing block is inside it.
- No element between the label and the page is positioned.
  This includes the sidebar's scroll area (`data-testid="sidebar-sections"` in `packages/ui/src/modules/platform/components/sidebar/sidebar-content.tsx`), the `nav`, and the chat view's frame (`flex h-dvh … overflow-hidden` in `packages/ui/src/app.tsx`).
- So the label belongs to the page, at its row's place far below the window.
  The page grows down to it: 1,165 px in the 768 px window, and 1,247 px with an agent's session list open.
- A wheel scroll at the end of a panel then scrolls the page, and the app slides out of the window.

The same label also breaks two other places:

- **Other views (Home, Settings, …):** their frame is `relative overflow-hidden`, so the page keeps the window's height.
  But the frame holds the hidden overflow.
  When something scrolls the label into view (a screen reader that moves to it, or find in page), the frame scrolls by 397 px.
  A wheel scroll cannot bring it back.
- **The Activity flyout of the collapsed rail:** the popover is positioned, so the page does not move.
  But the label is outside the flyout's own scroll area, so scrolling it into view leaves the list where it is.

### Fix

Make each classic-sidebar scroll area the containing block of its content, with Tailwind's `relative`:

- the sidebar's scroll area in `sidebar-content.tsx`
- the flyout's scroll area in `packages/ui/src/modules/platform/components/sidebar/sidebar-flyout.tsx`

Every other absolute element in these scroll areas already has its own `relative` parent: the agent rows, the shared-agent rows, and the filter button's dot.
So the change moves only the hidden labels.

### Options tested

Each option was applied to the live page and measured.
"Scroll into view" is `label.scrollIntoView({ block: "nearest" })`, which is how a screen reader or find in page brings the label into view.

| Option                                         | Page height in the chat view | What "scroll into view" moves                          | Verdict                                       |
| ---------------------------------------------- | ---------------------------- | ------------------------------------------------------ | --------------------------------------------- |
| None (today)                                   | 1,165 px                     | The page, 397 px                                       | The bug                                       |
| **A:** `relative` on the sidebar's scroll area | 768 px                       | The sidebar's list, 474 px                             | **Picked**                                    |
| **B:** `relative` on the chat view's frame     | 768 px                       | The frame, 397 px; a wheel scroll cannot bring it back | Worse than today                              |
| A + B                                          | 768 px                       | The sidebar's list, 474 px                             | B adds nothing                                |
| **D:** remove the hidden label                 | 768 px                       | Nothing                                                | Changes screen-reader text and two unit tests |
| `overflow: hidden` on `html`                   | 1,165 px                     | The page, 397 px                                       | No fix                                        |
| `relative overflow-clip` on the frame          | 768 px                       | Nothing; the frame cannot scroll                       | Hides the next leak instead of fixing it      |

With A, a real wheel scroll over the conversation moved nothing.
A wheel scroll over the sidebar scrolled it to its last item (**View more**) and stopped there.
The sticky **Activity** header stayed at the top of the sidebar.

### Out of scope

- **The new layout (`new-layout` on):** its sidebar tree has no leak.
  Its only hidden label (`AgentCue` in `sidebar-v2/activity-dot.tsx`) sits inside a `relative` agent row.
  The live check was not run, because the server's feature setting decides the layout and it is off for the dev user.
- **A guard on the frame:** B and `overflow-clip` were both tested and rejected (see the table).
- **Architecture docs:** `docs/architecture/home-feed.md` describes what the sidebar lists, not how it scrolls, so no page changes.

## Conventions & glossary

- **Classic layout:** the UI with the `new-layout` feature off; it renders `Sidebar` from `modules/platform/components/sidebar/`.
- **Hidden label:** a `sr-only` span that only screen readers read.
- **Containing block:** the nearest positioned (`relative`, `absolute`, `fixed`, `sticky`) ancestor; an absolute element is placed and clipped against it.
- **Frame:** the outer `div` of `MainApp` in `app.tsx` that holds the sidebar and `main`.
- Apply the `/react-ui-engineering` skill.
- No code comment: the comment guidelines allow only typed comments, and none fits; the commit body says why `relative` is there.

## Whole-feature smoke test

Run it in the classic layout in a short window, so the Activity list runs below the bottom (for example 1024 × 768).
To make a session unread: send a message in it, and open another session before the reply arrives.

1. **AC-1:** with the sidebar open and an unread session below the bottom of the window, open a session with a short conversation.
   Scroll down over the conversation with the mouse wheel.
   The top bar, the top of the sidebar and the message box stay where they were.
2. **AC-2:** scroll down over the sidebar past its last item.
   The sidebar stops at its last item, and the rest of the app does not move.
3. **AC-3:** open an agent in the sidebar that has more than five sessions, and click **View more** in its list.
   Scroll down over the conversation.
   The app stays where it was.
4. **Home:** open Home, and run the probe from the sub-issue's smoke test.
   Only the sidebar's list scrolls; the page frame does not.
5. **Flyout:** collapse the sidebar, and open the **Activity** flyout from the rail.
   Run the probe; the flyout's list scrolls to the row.

## Delivery

The fix is one atomic commit.
The whole fix lands as a single PR for https://github.com/dam-agents/dam/issues/5841, which also closes https://github.com/dam-agents/dam/issues/5092.
