# 01 — Inputs stay 16px on a phone

**Part of:** Chat fits the visible screen on a phone — see [README](./README.md)

## Context

iOS Safari zooms the page when a text field below 16px takes focus.
The chat composer is 14px, so a tap on it zooms the page, scrolls the header away and clips the content.
This slice sets every text field the chat UI uses to 16px below the `md` breakpoint.
Desktop sizes do not change.

## Implementation plan

Apply the `/react-ui-engineering` skill.

1. `packages/ui/src/components/ui/input.tsx`: add `max-md:text-base` to all three `size` variants (`default`, `sm`, `xs`).
   Keep the heights (`h-10`, `h-8`, `h-7`).
   `file:text-sm` stays.
2. `packages/ui/src/components/ui/textarea.tsx`: add `max-md:text-base` to the base class.
3. `packages/ui/src/modules/sessions/components/chat-input.tsx` (the composer `Textarea`, line 309): add `max-md:text-base` to its class list.
   The composer sets `text-sm leading-[22px]` itself, so it needs its own change.
   Check that the 56px bar height and the auto-resize in `packages/ui/src/hooks/use-auto-resize.ts` still measure one line correctly at 16px.
4. Three raw text `<input>` elements do not use the primitives.
   Add `max-md:text-base` to each:
   - `packages/ui/src/modules/agents/components/editable-agent-identity.tsx` (line 153), the agent-name editor.
     The chat header passes `text-sm` to it from `packages/ui/src/modules/sessions/components/classic-chat-identity.tsx`.
     The name grows from 14px to 16px while a person edits it on a phone.
     That is accepted.
   - `packages/ui/src/modules/command-palette/components/palette-dialog.tsx` (line 110).
   - `packages/ui/src/modules/slack/components/slack-channel-combobox.tsx` (line 108).
     Leave `type="file"`, checkbox and range inputs as they are.
5. Search `packages/ui/src` for any other text-entry element outside `components/ui/`: `<input`, `<textarea`, `contentEditable`.
   Apply the same class to each one that takes typed text.
6. Find the call sites that pass `size` to `Input`.
   The props can sit on later lines, so a one-line grep misses them.
   The heights stay `h-8` and `h-7`, so check at 375px wide that 16px text does not clip.

A text size passed in a call site's `className` keeps working on desktop.
Below `md`, `max-md:text-base` takes precedence, because variant utilities sort after plain ones.
Confirm this in the browser at 375px before you rely on it.

## Acceptance criteria

- [ ] Below 768px wide, each text field reports `font-size: 16px`: `Input` in every size, `Textarea`, the composer, and the three raw inputs.
- [ ] At 768px and wider, every field keeps its old size (the composer stays 14px).
- [ ] In iOS Safari on a phone, a tap on the composer does not zoom the page.
- [ ] In iOS Safari on a phone, a tap on the agent-name editor and on a form field in a dialog does not zoom the page.
- [ ] No `Input` with `size="sm"` or `size="xs"` clips its text at 375px wide.
- [ ] `mise run //packages/ui:check` and `mise run check:comment-types` pass.

## Smoke test

1. Run `mise run //packages/ui:check`.
2. Build and restart the UI: `mise run cluster:build -- ui`.
3. Open the app in a desktop browser.
   Resize the window to 375px wide.
   Read `getComputedStyle(el).fontSize` for the composer, the agent-name editor, the command palette input and a dialog field.
   Each reports `16px`.
   At 1280px wide, the composer reports `14px`.
4. Open the app in iOS Simulator Safari, sign in, and open a chat.
   Tap the composer.
   The page does not zoom.
   Close the keyboard, then tap the agent name to rename it.
   The page does not zoom.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
