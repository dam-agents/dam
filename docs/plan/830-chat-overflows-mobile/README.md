# Chat fits the visible screen on a phone

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/830

## Goal

On a phone, the chat fills exactly the visible screen.
The header and the composer stay in place.
Only the message list scrolls.

Focusing the composer does not zoom the page.
Showing the on-screen keyboard or the address bar does not push the header or the composer off the screen.

Today, a tap on the composer zooms the page in iOS Safari.
The header scrolls away, and the content clips on both sides.
The zoom stays after the keyboard closes and after a reload.
(Reproduced in iOS Safari on an iPhone 17 Pro simulator, iOS 26.4.)

## Approach

Two causes produce this, and each one hides the other.

**Cause 1 — input zoom.**
iOS Safari zooms the page when a text field below 16px takes focus.
The chat composer is 14px.
`Input` is 14px, 12px or 12px by size, and `Textarea` is 14px.
Three raw text `<input>` elements do not use these primitives.

**Cause 2 — the frame ignores the keyboard.**
iOS Safari does not resize the layout viewport when the keyboard opens.
It pans the page to show the focused field.
The app frames use `h-dvh`, which follows the address bar but not the keyboard.
So the header leaves the screen.
On a test page with the keyboard open, the visible area was 377px high and sat 323px down the page.

What a test page showed in iOS Safari 26.4:

- `interactive-widget=resizes-content` in the viewport meta: iOS Safari ignores it.
  The header still left the screen.
- A frame sized from `window.visualViewport`: the header stayed on screen, the composer sat directly above the keyboard, and only the list scrolled.

The probe frame was `position: fixed; top: 0; height: visualViewport.height; transform: translateY(visualViewport.offsetTop)`.
Nobody checked what happens when the keyboard closes on that page, or how Android Chrome behaves.
Slice 02 covers both.

The fix has two parts:

- Slice 01 sets text fields to 16px below the `md` breakpoint.
  Desktop stays as it is.
- Slice 02 adds one hook.
  The hook publishes the visible area as two CSS variables.
  The frames read them and fall back to `100dvh`.

Out of scope:

- The Keycloak sign-in page.
  It zooms on focus too, but it lives in the `keycloak-theme` package.
- Dialogs and menus drawn through portals.
  They stay outside the frame and keep today's behavior.
- A tablet at 768px or wider.
  It keeps the desktop layout.
- The `Select` primitive.
  It is a button and takes no typed text.
- Mobile rules for the whole design system.
  The mobile audit (#3144) owns that question.

No architecture page describes the app frame or the viewport, so no page under `docs/architecture/` changes.

## Sub-issues

| #   | Title                                                                            | Scope                                                                                                                                                             | Depends on |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 01  | [Inputs stay 16px on a phone](./01-inputs-16px-on-phone.md)                      | Below `md`, `Input`, `Textarea`, the composer and the three raw text inputs use 16px. No zoom on focus.                                                           | —          |
| 02  | [The frame follows the visible viewport](./02-frame-follows-visible-viewport.md) | One hook publishes `visualViewport` as CSS variables. The two root frames read them, and the chat root fills its parent. The keyboard no longer moves the header. | 01         |

Slice 01 comes first.
The zoom hides the keyboard behavior, so a tester cannot judge slice 02 on a real phone until the zoom is gone.

## Conventions & glossary

- **Layout viewport:** the page area that `100%` and `dvh` measure.
- **Visual viewport:** the part of the page the person sees.
  It shrinks when the keyboard opens and shifts when the page pans.
  `window.visualViewport` reports it.
- **Phone:** a viewport below the `md` breakpoint (768px).
  `useIsDesktop` in `packages/ui/src/hooks/use-is-desktop.ts` uses the same breakpoint.
- **Frame:** the root element that gives a view the height of the screen.
  Two live in `packages/ui/src/app.tsx`.
  One lives in `packages/ui/src/modules/sessions/views/chat-view.tsx`.

Skills: both slices are UI work in `packages/ui`.
Apply `/react-ui-engineering`.
No server-side TypeScript changes.

Rules for both slices:

- Add no tests.
  Verification is `mise run //packages/ui:check`, the existing suite, and the manual smoke test.
- Comment only code that is hard to reason about.
  Run `mise run check:comment-types` after changing code.
- Write Markdown with one sentence per line.
  `mise run fix:markdown` applies it.

How to test:

- Use iOS Simulator Safari, not a resized desktop window.
  A resized window has no on-screen keyboard and no address bar, so it cannot show this bug.
- Build the UI image and restart its pod with the `cluster-ops` skill (`mise run cluster:build -- ui`).
  Open the app URL with `xcrun simctl openurl booted <url>`.
- Type with the on-screen keys.
  Pasting into a field from the simulator tool does not land text.
- iOS keeps a page zoom across a reload.
  Open the URL again from a fresh navigation to reset it.
- A screenshot can show the state from one action ago.
  Take a second screenshot before you judge.

## Whole-feature smoke test

Run these in iOS Simulator Safari on a phone, after both slices.

1. Open a chat.
   The header, the message list and the composer fit the screen.
   A swipe on the header does not move the page.
2. Tap the composer.
   The page does not zoom.
   The header stays at the top.
   The composer sits directly above the keyboard.
   The list scrolls on its own.
3. Type three lines.
   The composer grows.
   The header stays.
4. Close the keyboard.
   The chat fills the whole screen again.
   No gap or offset remains.
5. Tap the agent name in the chat header and start the rename.
   The page does not zoom.
6. Open the Files section on the phone, then the keyboard in the chat.
   The panel stays inside the visible area.
7. Open the same chat in a desktop browser at 1280px wide.
   It looks and behaves as before.
8. If an Android phone or emulator is at hand, repeat steps 1 to 4 in Chrome.
   If not, say so in the pull request.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/830.

The PR body carries before and after screenshots from the iOS Simulator, as the web UI proof rule asks.
No control label, flow or screen changes, so `.quality-inspector/` and `.design-desk/` stay as they are.
