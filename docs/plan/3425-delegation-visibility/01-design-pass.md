# 01 — Design pass

**Part of:** Delegation visibility — see [README](./README.md)

## Context

The feature adds two new surfaces to the chat: an expandable block inside an assistant
message, and a view of another agent's conversation opened from it. Both were chosen in
principle (compact in the message, whole conversation on a panel or right sidebar) but not
drawn. This slice settles the layout before any UI code, so slices 06 and 09 implement an
agreed design rather than improvise one. It produces no code.

## Implementation plan

1. Read what exists so the design reuses it rather than inventing parallel patterns:
   - `packages/ui/src/modules/sessions/components/tool-chip.tsx` and `activity-block.tsx`
     — the disclosure every tool call renders with (left rail, header button, chevron,
     actions slot). The Delegation block is a sibling of this, not a replacement.
   - `packages/ui/src/modules/experiments/components/experiment-dock-panel.tsx:241-290`
     — `InvocationRow`: status dot cascade (amber pulse waiting for room, emerald pulse
     running, red failed, muted otherwise), name, stage, status text. The node row should
     read the same.
   - `packages/ui/src/modules/sessions/views/chat-view.tsx:850-902` — the resizable right
     column (`DockedFilePanel`, `DockedArtifactPanel`, `ExperimentDockPanel`) with its
     `h-12` header row. The child view is a fourth docked panel in this column unless the
     design pass concludes otherwise.
   - `packages/ui/src/modules/sessions/components/sessions-sidebar.tsx:105` — how a per
     session cost is shown today, so cost formatting matches.
2. Draw the Delegation block, in Figma via the Figma MCP or as a static mockup, in these
   states: collapsed summary line (count, aggregate status, aggregate cost); expanded with
   two children done; one child running and one failed; a grandchild nested under a child;
   cost column absent (telemetry off or aged out); a node expanded to show prompt, result
   and error. Include where the raw script text goes (collapsed inside the block).
3. Draw the child view for a finished child: header with label, status, duration, cost, a
   read-only marker; the conversation body reusing the chat message rendering; and how it
   differs for a running child (opens the child's live chat instead).
4. Decide, with the user, panel in the right column versus a sidebar, and record the
   reason in one sentence.
5. Write the outcome into the README under a new `## Design` section: the agreed states,
   the layout decision, and a short component spec (component names, props at the level of
   "takes nodes and an onOpen callback", what is reused). Link the mockups.
6. Amend the plan commit and force-push; the branch carries only the ADR and the plan at
   this point.

## Outcome

Done 2026-09-23. The prototype is `issue-3425-prototype.html` beside this file and the
agreed design is the README's `## Design` section.

## Acceptance criteria

- [x] Mockups exist for every state listed in steps 2 and 3 and the user approved them.
- [x] The README has a `## Design` section with the layout decision and the component spec.
- [x] Slices 06 and 09 need no further layout decision to start.

## Smoke test

None to run; the deliverable is the README section and the mockups. `mise run //docs:check`
still passes after the README edit (the plan folder is not an architecture page, so the
size cap does not apply to it).
