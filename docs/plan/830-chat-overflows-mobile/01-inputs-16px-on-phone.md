# 01 — Inputs stay 16px on a phone

**Part of:** Chat fits the visible screen on a phone — see [README](./README.md)

## Context

iOS Safari zooms the page when a text field below 16px takes focus.
The chat composer is 14px, so a tap on it zooms the page, scrolls the header away and clips the content.
This slice sets every text field the chat UI uses to 16px on a touch device (`pointer: coarse`).
A phone in landscape is wider than 768px, so a width breakpoint would miss it.
Sizes with a mouse do not change, at any width.

## Implementation plan

Apply the `/react-ui-engineering` skill.

1. `packages/ui/src/components/ui/input.tsx`: add `pointer-coarse:text-base` to the base class, so it covers all three `size` variants (`default`, `sm`, `xs`).
   Keep the heights (`h-10`, `h-8`, `h-7`).
   `file:text-sm` stays.
2. `packages/ui/src/components/ui/textarea.tsx`: add `pointer-coarse:text-base` to the base class.
3. The composer `Textarea` in `packages/ui/src/modules/sessions/components/chat-input.tsx` needs no change of its own.
   Its `text-sm` replaces only the primitive's plain `text-sm`, so tailwind-merge keeps the primitive's `pointer-coarse:text-base`.
   Check that the 56px bar height and the auto-resize in `packages/ui/src/hooks/use-auto-resize.ts` still measure one line correctly at 16px.
4. Four raw text `<input>` elements do not use the primitives.
   - `packages/ui/src/modules/agents/components/editable-agent-identity.tsx`, the agent-name editor.
     Its callers pass the name size in `nameClassName`: `text-sm` in the chat header, `text-lg` in the sandbox home header.
     In edit mode, `nameClassName` moves to the wrapper, and the input inherits its size.
     The input gets `pointer-coarse:text-[length:max(1em,16px)]`, so a 14px name grows to 16px while a person edits it on a phone, and an 18px name keeps 18px.
   - `packages/ui/src/modules/command-palette/components/palette-dialog.tsx`: add `pointer-coarse:text-base`.
   - `packages/ui/src/modules/slack/components/slack-channel-combobox.tsx`: add `pointer-coarse:text-base`.
   - `packages/ui/src/components/ui/searchable-select.tsx`, the search field in the open list (used by the schedule forms): add `pointer-coarse:text-base`.
     Leave `type="file"`, checkbox and range inputs as they are.
5. Search `packages/ui/src` for any other text-entry element: `<input`, `<textarea`, `contentEditable`.
   Apply the same class to each one that takes typed text.
6. Find the call sites that pass `size` to `Input`.
   The props can sit on later lines, so a one-line grep misses them.
   Check at 375px wide that 16px text does not clip.
   The tightest box is the `default` size: `h-10` with `py-2` and a border leaves 22px for a 24px line.

A text size passed in a call site's `className` keeps working with a mouse.
On a touch device, `pointer-coarse:text-base` takes precedence, because variant utilities sort after plain ones.
Confirm this in the browser with touch emulation before you rely on it.

## Acceptance criteria

- [ ] On a touch device, in portrait and in landscape, each text field reports `font-size: 16px`: `Input` in every size, `Textarea`, the composer, and the four raw inputs.
  The agent-name editor in the sandbox home header keeps 18px.
- [ ] With a mouse, at any width, every field keeps its old size (the composer stays 14px).
- [ ] In iOS Safari on a phone, a tap on the composer does not zoom the page.
- [ ] In iOS Safari on a phone, a tap on the agent-name editor and on a form field in a dialog does not zoom the page.
- [ ] No `Input` clips its text at 375px wide, in any size.
- [ ] `mise run //packages/ui:check` and `mise run check:comment-types` pass.

## Smoke test

1. Run `mise run //packages/ui:check`.
2. Build and restart the UI: `mise run cluster:build -- ui`.
3. Open the app in a desktop browser.
   Turn on touch emulation at 375px wide.
   Read `getComputedStyle(el).fontSize` for the composer, the agent-name editor, the command palette input and a dialog field.
   Each reports `16px`.
   Without touch emulation, at 375px and at 1280px wide, the composer reports `14px`.
4. Open the app in iOS Simulator Safari, sign in, and open a chat.
   Tap the composer.
   The page does not zoom.
   Close the keyboard, then tap the agent name to rename it.
   The page does not zoom.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
