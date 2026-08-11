# 09 — Sidebar summaries, docs, final sweep

**Depends on:** 02–08 (everything visual is in place)
**Part of:** 3208 skills UI rework — see [README](./README.md)

## Context

The closing slice: align the sandbox-home sidebar's per-state summary copy, update the
architecture page inside its size gate, run the whole-feature visual sweep in both themes,
and move the deviations register out of the plan folder before it is deleted.

## Implementation plan

Apply `/react-ui-engineering` (sidebar) and the documentation guidelines
(`docs/guidelines/documentation-guidelines.md`).

1. **Sidebar summaries** (`hooks/use-section-summaries.ts`): Skills line per state —
   running `K on across M sources`; running·empty `None yet`; stopped
   `K on · as of {relative time}` (from `standaloneSnapshot.capturedAt`); never-run
   `Not known yet`. Setup line integrates slice 08's ` · not offered` suffix.
2. **Architecture page** (`docs/architecture/skills.md`): document what the surface now
   shows per state (Stopped snapshot panel, never-run scope, the visibility field from
   slice 03) at architecture altitude — no pixel detail. Budget: the page sits at 39,799
   of the 40,000 gate after #3023 (~200 chars); reclaim space with the gate's sanctioned cuts
   (content that dropped to code level, leaked decision rationale). If the delta cannot
   fit through sanctioned cuts, stop and propose a page split as its own PR — do not
   reword-to-fit. Update `Last verified:`. Check with `node scripts/doc-size.mjs` (or the
   `mise` task that wraps it).
3. **Deviations register**: copy the final table from the README into the PR description
   (edit via `gh pr edit --body`), and post it as a comment on issue #3208 so the record
   survives the plan folder's deletion.
4. **Follow-up drafts — act before the folder is deleted.** The README carries five drafts
   (A deferred install, B set management, C wizard set-apply, D multi-select and
   search-scoped bulk, E the two #3243 engineering findings). C and D are descoped from
   #3023, which closed on the promise that they would be filed after #3208 lands. Ask Petr
   which to file, file the approved ones against epic #3022, and **post the full draft text
   as a comment on #3208 for any he defers** — the plan folder's deletion in this same slice
   is otherwise where they disappear. Do not file without approval.
5. **Final sweep**: walk the whole-feature smoke test from the README in dark and light,
   comparing each state against fresh prototype renders; fix drift found on the way
   (small fixes belong to this slice; anything structural goes back to its slice).

## Acceptance criteria

- [ ] Sidebar Skills/Setup summaries match the prototype's per-state copy.
- [ ] `docs/architecture/skills.md` documents the new state surfaces, passes the size
      gate, and carries an updated `Last verified:` date.
- [ ] PR description contains the final deviations register; issue #3208 has it as a
      comment.
- [ ] Every follow-up draft is either filed as an issue or preserved as a comment on
      #3208 **before** the commit that deletes the plan folder.
- [ ] Whole-feature smoke test (README) passes in both themes; `mise run check` and
      `mise run test` green.

## Smoke test

`mise run check && mise run test`, then the README's whole-feature smoke test end to end.
This slice's own artifact check: the doc-size script passes and the PR body shows the
register.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
