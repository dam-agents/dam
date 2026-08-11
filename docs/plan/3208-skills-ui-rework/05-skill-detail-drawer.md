# 05 — Skill detail drawer

**Depends on:** 02-created-here-rows (kebab/publish gating), 03-source-cards (visibility field)
**Part of:** 3208 skills UI rework — see [README](./README.md)

## Context

The prototype presents one drawer design for every skill kind (source-backed, created-here,
image-shipped, not-installed). Live has separate dialogs (`skill-render-modal.tsx` for
source-backed, `local-skill-render-modal.tsx` + `skill-markdown-modal.tsx` for local).
This slice restyles them to the one design — unifying markup where cheap, but not forcing a
single component if the two data paths (pinned source read vs. pod read) make that noisy.

Render `openDetails('pdf-fill')` and `openDetails('jira-sync')` prototype states first;
also open a created-here and an image skill in the prototype.

## Implementation plan

Apply `/react-ui-engineering`.

1. **Header row**: skill name; `Update to latest` button immediately right of the name,
   only when the row is drifted (reuse the shared `isDrifted` predicate — the drawer and
   the row pill must agree); spacer; then the state control:
   - toggleable (source-backed) skills: `On`/`Off` label + switch, driving the same
     mutation as the row toggle so list, bulk button, and counts follow;
   - image skills: static `Always on · ships with the image`;
   - created-here: static `Always on`; not-installed: `Not installed`.
   Close (✕) stays rightmost.
2. **Meta chips** under the title: visibility badge (`Public`/`Private` from slice 03's
   field; `Standalone` for created-here; `Built-in` for image), source (repo or
   `created in this sandbox` / `sandbox image`), version (commit sha / `local` / `image`),
   and for created-here with a publish record a PR chip (`In review · #482` style — live
   labels per D1).
3. **File strip**: `path/SKILL.md · size`, then right-aligned: View-on-GitHub icon button
   (source-backed only), Download icon button, and the `Source`⇄`Preview` toggle that
   flips the pane between rendered Markdown (frontmatter block + body) and the raw file.
4. **Footer** (created-here only): `Publish…`/`Publish again…` per the shipped gating
   (D3), spacer, `Delete skill` (danger, closes drawer then runs the existing confirm).
5. Keep both data paths working: source-backed preview via `getSkillContent` (pinned read,
   wakes for private sources), local preview via the read-local path with its size caps.

## Acceptance criteria

- [ ] All four skill kinds open the drawer and match the prototype's layout, both themes.
- [ ] Toggling in the drawer updates the row, source bulk button, and counts immediately.
- [ ] Update button appears exactly when the row shows drift; both share one predicate.
- [ ] Source⇄Preview flips rendered/raw; download and GitHub actions unchanged.
- [ ] Publish/Delete in the footer follow the gating from slice 02.

## Smoke test

`mise run ui:check && mise run ui:test`. Dev cluster: open drawers for a drifted public
skill (Update present), a private-source skill (Private chip), a created-here skill with a
merged PR (chip + no Publish), and an image skill (Always on). Toggle from the drawer and
watch the row follow.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
