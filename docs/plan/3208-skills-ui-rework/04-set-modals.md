# 04 — Set modals restyle

**Depends on:** 01-page-shell-and-grouping
**Part of:** 3208 skills UI rework — see [README](./README.md)

## Context

#3023 built both set modals against the prototype's copy and behavior but the current
design system. This slice migrates their visuals. Behavior (pre-checking, validation via
`resourceNameSchema`, additive apply, union counting) is done — do not rewrite it.

Render `openSave()` and `openApply()` prototype states (both themes) first.

## Implementation plan

Apply `/react-ui-engineering`.

1. `components/skills/save-skill-set-modal.tsx`:
   - Subtitle: `Starts from what's on here — unmark anything you don't want in the set.`
   - `Set name` field with hint line under it (existing validation messages unchanged).
   - Grey banded bar: `N skills selected` left, `Select all · Clear` link-buttons right.
   - Scroll list grouped by source with small-caps group headers; each row: check square,
     name over description, right-aligned muted `on here` for skills currently on.
   - Footer note: `Only skills from a connected source can go in a set — a set installs by
     name, and skills authored here or shipped with the image have nowhere to install
     from.` Buttons: Cancel / Create (disabled until valid name and ≥1 skill).
2. `components/skills/add-skill-sets-modal.tsx`:
   - Subtitle: `Pick any number. Their skills turn on alongside what you already have —
     overlap is fine, and nothing gets turned off.`
   - Rows separated by dividers: checkbox, set name, then
     `N skills · a, b, c, +K` followed by **whitespace** then the verdict
     (`adds N` / `already all on`), plus the amber `· K not in a connected source` clause
     when applicable.
   - Empty state: `No saved skill sets yet — save one from this sandbox first.`
   - Footer: `N sets · turns on M new skills` (union), Cancel / Add skills.
3. Keep the shipped Modal semantics: Escape and backdrop clicks do not close (the
   prototype states this matches `modal.tsx` on purpose).

## Acceptance criteria

- [ ] Both modals visually match their prototype renders in both themes.
- [ ] Save: pre-checked with what's on; validation messages and uniqueness error identical
      to `resourceNameSchema` + the shipped uniqueness copy; Create disabled rules hold.
- [ ] Add: verdict spacing/amber clause per prototype; footer counts the union; apply is
      additive (nothing turns off).
- [ ] `mise run ui:check && mise run ui:test` green.

## Smoke test

Dev cluster: save a set from a sandbox with mixed sources; reopen Save and confirm the
banded bar counts; open Add sets on another sandbox missing one source and confirm the
amber clause and `adds N`; apply two overlapping sets and confirm the union count and that
no skill turned off.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
