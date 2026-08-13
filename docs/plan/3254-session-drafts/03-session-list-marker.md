# 03 — Draft marker in the session list

**Depends on:** [01-drafts-in-memory](./01-drafts-in-memory.md)
**Part of:** Keep a message draft with the session it was written for — see [README](./README.md)

## Context

Show a muted pencil icon in the session row's status-dot slot for idle sessions that hold a
draft. Needs-approval, working, and background work (added by #3159 after this plan was
written) always win the slot; the pencil is the quietest marker of the set. Driven entirely by
the drafts map from 01. Apply the **/react-ui-engineering** skill.

## Implementation plan

1. **Row rendering** —
   `packages/ui/src/modules/sessions/components/session-row.tsx`:
   - Add `draft?: boolean` to the row props (:38-48) and thread it into `SessionIndicators`
     (:216-290).
   - Extend the early return at :234-242 (which checks `scheduled`, `terminal`, `channel`,
     `needsApproval`, `working`, and `hasBackgroundWork`) with `!draft` — otherwise the marker
     never renders on an otherwise-bare idle row.
   - Extend the status-slot ternary at :273-287: `needsApproval ? <approval dot> : working ?
     <WorkingDots> : hasBackgroundWork ? <slow WorkingDots> : draft ? <pencil> : null`. The
     pencil ranks last — background work is live activity and wins over a parked draft.
   - The pencil: use the edit/pencil icon from the **same icon set** the strip already imports
     (`Code`, `Hashtag`, `Time` at the top of `session-row.tsx`), sized like those icons,
     colored `text-muted-foreground` (quieter than the `accent` of the two live markers).
     Accessibility mirrors the approval dot's pattern (:263-266): `role="img"`,
     `aria-label="Has a draft"`, plus a `title`, and `data-testid="session-draft-marker"`.

2. **Row computation** —
   `packages/ui/src/modules/sessions/components/sessions-sidebar.tsx`, `renderRow`
   (:126-165): `draft` is true when the drafts map has content for
   `draftKey(agentId, s.sessionId)` and the session is not terminal-mode. Blank-chat drafts
   have no row — nothing to render.
   - Subscribe with a **stable derived selector**, not the raw map: e.g.
     `useStore(useShallow((s) => keysWithDraftContent(s.drafts)))` (helper next to
     `draftHasContent` in `lib/draft-key.ts`). The composer writes on every keystroke; shallow
     equality on the key list keeps the sidebar from re-rendering per keystroke — membership
     changes only when a draft appears or disappears.

3. **Priority stays structural** — the ternary in step 1 already encodes
   approval > working > background work > draft; unread stays orthogonal (it is title
   font-weight, not a dot). No other component changes.

## Acceptance criteria

- [ ] An idle session with a draft shows the muted pencil with "Has a draft" as its
      accessible label.
- [ ] A working session with a draft shows the working dots, no pencil; one waiting on
      approval shows the approval dot, no pencil; one with running background work shows the
      slow dots, no pencil. The pencil (re)appears when the session returns to idle.
- [ ] Emptying the box (delete all text, remove attachments) removes the pencil immediately.
- [ ] Typing in the composer does not re-render the sidebar per keystroke (selector is
      shallow-compared key membership; verify with React DevTools profiler or by review).
- [ ] Rows with only a draft (no schedule/terminal/channel/status) render the indicator strip.
- [ ] `mise run ui:check` and `mise run ui:test` pass.

## Smoke test

`mise run ui:check && mise run ui:test`, then manually on the dev cluster
(`http://localhost:4444`): README whole-feature smoke steps 1 and 7 — pencil on both drafted
idle rows, working/approval suppress it, clearing the box removes it.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
