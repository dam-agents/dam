# 02 — Created-here rows

**Depends on:** 01-page-shell-and-grouping
**Part of:** 3208 skills UI rework — see [README](./README.md)

## Context

The prototype's created-here rows are calm: clickable name, publish badge, kebab — no
description line, no inline buttons. Live rows carry a description, a `label · sourceName`
pill, and an inline Publish button. This slice restyles the row and moves Publish into the
kebab per decisions 2–3 (deviations D1–D3).

## Implementation plan

Apply `/react-ui-engineering`. All in
`components/skills/standalone-skill-row.tsx` (+ its group container as needed).

1. Row layout per prototype: name (opens the preview drawer), right-aligned publish pill,
   kebab. Drop the description line (drawer keeps it). Keep the divided-row treatment the
   group uses.
2. Publish pill: keep `PR_STATE_PILL` labels and variants exactly as shipped (D1). Render
   the bare label per the prototype's badge look, but keep it an `<a>` to `publish.prUrl`
   with the existing tooltip (which already names the source and date) (D2).
3. Remove the inline `Publish/Publish again` button. Kebab contents, in order:
   - `Preview SKILL.md` (calls the row's `onOpenSkill` path, same as clicking the name);
   - `Track from {sourceName}` — unchanged, merged-state only, with its
     `trackUnavailable` disabling;
   - `Publish…` / `Publish again…` — rendered only under the existing `canRepublish`
     rule (no record, or `closed`); disabled with the shipped tooltip when `canPublish`
     is false (no GitHub source);
   - `Download skill`;
   - `Delete skill` (danger).
4. The stopped/readOnly variant of the group renders no kebab actions that mutate — verify
   the readOnly prop still gates correctly after the restyle.

## Acceptance criteria

- [ ] Rows show name + pill + kebab only; description gone from the row, present in drawer.
- [ ] Pill labels/variants byte-identical to `PR_STATE_PILL` on main; pill still links to
      the PR with tooltip.
- [ ] No inline publish button; kebab offers Publish per the shipped gating, disabled
      (not hidden) when no GitHub source exists.
- [ ] Track from / Download / Delete behave exactly as before (`mise run ui:test` green).

## Smoke test

`mise run ui:check && mise run ui:test`. On the dev cluster with a sandbox holding created
skills in several PR states: compare the group against the prototype render; publish a new
skill via the kebab; confirm a merged skill offers Track from and no Publish; confirm a
closed one offers Publish again.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
