# 03 — Expanded output cap

**Part of:** Collapse an agent's tool activity into one group in chat — see [README](./README.md)

## Context

One step's expanded output has no size limit today, so one large command result pushes the rest of the conversation far off screen.
`ToolContentBlock` in `packages/ui/src/modules/sessions/components/tool-chip.tsx` renders the whole text in a `<pre>`.
This slice clips it to a fixed number of lines with a "Show all" control, while the copy button keeps copying the whole text.

## Implementation plan

Apply `/react-ui-engineering` and the `frontend-design` plugin skill (`/frontend-design:frontend-design`) for the clipped edge and the control.

1. In `tool-chip.tsx`, give `ToolContentBlock` a line cap: a module constant `OUTPUT_PREVIEW_LINES` (start at 40) and local `useState(false)` for `showAll`.
   Split the stripped text into lines; when it exceeds the cap and `showAll` is false, render the first `OUTPUT_PREVIEW_LINES` lines followed by a button "Show all (N lines)".
   When expanded, offer "Show less".
   The `CopyButton` keeps `value={stripped}` so copy is never clipped.
2. Make the clipped state visible: a short fade or a hairline at the cut and the control below it, styled as the hover actions and fold labels are, so it reads as part of the block rather than as a link in the output.
3. The cap applies to every tool output, inside or outside an activity group, so no change is needed in sub-issue 01.
4. Run `mise run //packages/ui:check`, `mise run //packages/ui:test` and `mise run check:comment-types`.

## Acceptance criteria

- [ ] An output of at most 40 lines renders whole with no control.
- [ ] An output of more than 40 lines renders 40 lines and a "Show all (N lines)" control; clicking it shows the whole output and offers "Show less".
- [ ] The copy button copies the full output in both states.
- [ ] The existing `stripFences` tests in `packages/ui/src/__tests__/unit/tool-chip.test.ts` still pass.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.

## Smoke test

Run `mise run //packages/ui:test` and `mise run //packages/ui:check`.
Then on the dev server send "run `seq 1 200`" to an agent, open the step: 40 lines show with "Show all (200 lines)"; click it and all 200 lines show; copy and paste the result somewhere to confirm it holds 200 lines.
