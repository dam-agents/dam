# 01 — Page shell and grouping

**Part of:** 3208 skills UI rework — see [README](./README.md)

## Context

The prototype arranges the Running surface as: search field → drift banner → counts line
with the two set buttons → three groups in the order **Created in this sandbox → Sourced
from GitHub → Included with sandbox image**. Live order today puts the image group in the
middle. This slice moves the shell to the prototype's structure and typography without
touching row internals (slices 02/03) or modals (04).

Render the prototype's Running state (light and dark) before starting — see README.

## Implementation plan

Apply `/react-ui-engineering`.

1. `components/skills/skills-surface.tsx`: move `<BuiltInSkillsGroup>` below
   `<SkillSourcesSection>` so the image group renders last in the running branch. Keep the
   readOnly/placeholder branches working (they are restyled in 06/07).
2. Group headers: match the prototype's section-title treatment (small-caps muted label,
   e.g. `CREATED IN THIS SANDBOX`) across `standalone-skills-group.tsx`,
   `skill-sources-section.tsx`, `built-in-skills-group.tsx`. The GitHub group head carries
   the `Add source` button (already the case on the branch — keep it right-aligned in the
   head per the prototype).
3. `components/skills/skills-search-header.tsx`: counts line copy per prototype —
   `N skills · M connected sources · K on` while idle, `N skills match "q"` while
   searching; set buttons (`Add skill sets…`, `Save as skill set…`) sit right of the counts
   line. Search input placeholder: `Search skills across all connected sources…`.
4. `components/skills/skill-drift-banner.tsx`: sits between search and counts line;
   copy `N skills are out of date.` + mono skill names + `Update all` button right-aligned,
   per the prototype render.
5. Verify search behavior against the prototype: matching rows surface even when their
   card's extra rows are collapsed; show-more hints hide while searching; a group with no
   matches hides; a **source card** with no matches stays visible (header only). Align the
   branch's search wiring where it differs.

## Acceptance criteria

- [ ] Group order on Running is Created → GitHub sources → Image; nothing else reordered.
- [ ] Counts line, drift banner, and set buttons match the prototype's Running render in
      placement and copy, both themes.
- [ ] Searching hides empty groups but keeps zero-match source cards visible, and clears
      back to each card's own collapsed state.
- [ ] Stopped / never-run / empty branches still render (unstyled is fine at this slice).

## Smoke test

`mise run ui:check && mise run ui:test`. Then on the dev cluster: open a running sandbox's
Skills page, compare against fresh prototype renders (running, light + dark) side by side;
type a query matching only one source's collapsed skill and confirm it surfaces and the
other groups hide.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
