# 02 — The frame follows the visible viewport

**Depends on:** 01-inputs-16px-on-phone
**Part of:** Chat fits the visible screen on a phone — see [README](./README.md)

## Context

With the keyboard open, iOS Safari pans the page, and a frame of `100dvh` moves with it.
The header leaves the screen.
This slice adds one hook that publishes the visible area as CSS variables, and makes the three `h-dvh` frames read them.
The result is a frame that always matches what the person sees.

## Implementation plan

Apply the `/react-ui-engineering` skill.

1. New hook `packages/ui/src/hooks/use-app-viewport.ts`, next to `use-is-desktop.ts`.
   - It listens to `resize` and `scroll` on `window.visualViewport`.
   - It acts only on touch devices: `matchMedia("(pointer: coarse)")`.
     A mouse device keeps `100dvh` exactly.
   - When the pointer is coarse and `visualViewport.scale` is 1, it sets `--app-height` to `visualViewport.height` and `--app-offset-top` to `visualViewport.offsetTop`, in px, on `document.documentElement`.
   - Otherwise it removes both variables.
     A person who pinch-zooms keeps the zoom; the frames fall back to `100dvh`.
   - It uses no React state.
     It writes the variables straight to the element, so a keyboard animation does not re-render the tree.
   - Its cleanup removes the listeners and the variables.
   - It does nothing when `window.visualViewport` does not exist.
2. Mount the hook once in `MainApp` in `packages/ui/src/app.tsx`, beside `useLiveEvents()` and the other app-level hooks.
   Both root frames sit under `MainApp`.
3. Add one shared frame rule to `packages/ui/src/App.css`, next to the `.safe-bottom` and `.safe-top` helpers.
   The baseline that worked on the test page is `position: fixed; inset-inline: 0; top: 0; height: var(--app-height, 100dvh); transform: translateY(var(--app-offset-top, 0px))`.
   Keep the rule inside `@media (pointer: coarse)`, so a desktop frame stays as it is today.
   Without that media query, the transform makes the frame the containing block of every fixed child on desktop too.
4. Use the rule on the two root frames in `packages/ui/src/app.tsx`: line 185 (the chat view) and line 204 (every other view).
   Keep their other classes.
   Drop `h-dvh` where the rule now sets the height.
5. `packages/ui/src/modules/sessions/views/chat-view.tsx` line 1271 is the classic chat root.
   It sits inside the chat frame from step 4, so it needs no frame of its own.
   Change `h-dvh` to `h-full`, or to `min-h-0 flex-1` if `h-full` does not resolve.
   Check that it still fills the `<main>` at every width.
6. Check the fixed children of the frame with the keyboard open.
   The transform makes the frame their containing block, so they follow the visible area.
   That is the wanted result.
   - The phone side panel in `packages/ui/src/modules/sessions/components/classic-chat-layout.tsx` (`max-md:fixed max-md:inset-0`).
   - The Getting started dock in `packages/ui/src/modules/getting-started/components/getting-started-dock.tsx`.
   - Anything that uses `has-[[data-full-page]]`.
7. Leave the views that use `min-h-dvh` or `h-dvh` outside this frame as they are: `startup-error-view.tsx`, `public-agent-view.tsx`, `usage-report-view.tsx`.
   The keyboard does not matter on them.

If `top: var(--app-offset-top)` fits better than the transform, use it.
Check in the simulator first: it drops the containing-block effect from step 6.

## Acceptance criteria

- [ ] In iOS Safari on a phone, with the keyboard open on the composer: the header is fully visible at the top, the composer sits directly above the keyboard, the list scrolls on its own, and the page itself does not scroll.
- [ ] Typing three lines keeps all of that true while the composer grows.
- [ ] After the keyboard closes, the chat fills the whole screen.
  No gap or offset remains.
- [ ] Showing and hiding the address bar does not make the page scroll as a whole, and the frame keeps filling the screen.
- [ ] The Files side panel and the Getting started dock stay inside the visible area with the keyboard open.
- [ ] In a desktop browser at 1280px wide, the layout is the same as before.
  The two screenshots match.
- [ ] A pinch-zoom on a phone is not fought: the frame does not jump while the page is zoomed.
- [ ] `mise run //packages/ui:check` and `mise run check:comment-types` pass.

## Smoke test

1. Run `mise run //packages/ui:check`.
2. Build and restart the UI: `mise run cluster:build -- ui`.
3. Open the app in iOS Simulator Safari on a phone, sign in, and open a chat with many messages.
4. Tap the composer and type three lines with the on-screen keys.
   Check the header, the composer position and the list scroll as the acceptance criteria say.
5. Close the keyboard.
   Check that the frame is full height again.
6. Open the Files section on the phone while the keyboard is open in the chat.
   Check that the panel stays in view.
7. Open the same chat in a desktop browser at 1280px wide.
   Compare with a screenshot from `main`.
8. Repeat steps 3 to 5 in Android Chrome if a phone or an emulator is at hand.
   If not, state that in the pull request.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
