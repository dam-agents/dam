# 07 — Never-run and Running · empty

**Depends on:** 06-stopped-state (shares the non-running layout pieces)
**Part of:** 3208 skills UI rework — see [README](./README.md)

## Context

Two lighter states. **Never-run** is distinguished by `hasRun: false` from
`harnessConfig.snapshot` (contract: `packages/api-server-api/src/modules/harness-config/
schemas.ts`; UI hook: `modules/agents/api/harness-config.ts`) — no snapshot exists.
Decision 4 scopes the panel down: no skill picking, no "applied on first start" promise
(deviations D4, D5). **Running · empty** means no created skills and no connected sources;
the image group keeps rendering (D7).

Render the prototype's Never-run and Running · empty states first — then apply the
registered deviations on top; the prototype is *not* authoritative for the never-run copy.

## Implementation plan

Apply `/react-ui-engineering`.

1. **Never-run panel** in the surface's state branching:
   - Info notice: `This sandbox hasn't run yet — its skills are resolved inside the
     sandbox, so there's nothing recorded to show. Start it once and this page fills in.`
     with primary `Start sandbox`.
   - `Skills` group: dashed empty panel, copy scoped to the truth (D4), e.g.
     `Not known yet — start the sandbox to see and configure its skills.` Actions:
     primary `Start sandbox`, secondary `Add source`. **No** `Add skill sets` button and
     no first-start promise.
   - `Connected sources` group: same list as slice 06 **including the kebab** (D5), with
     the note `The source list is known before first boot; which of its skills are
     installed isn't.`
2. **Running · empty** branch (running + no created + no sources):
   - `Created in this sandbox` group: dashed empty panel — `No skills created in this
     sandbox yet. Drop a .md file here, or ask the agent to author one.` Wire the panel
     to the existing page-level drag-drop/upload path (`upload-skills-tab.tsx` /
     surface `onDrop`) so the copy stays true.
   - `Sourced from GitHub` group: dashed empty panel — `No skill sources connected. Add a
     GitHub repo to browse and install its skills — or start from a set you've already
     built.` Actions: primary `Add source`, secondary `Add skill sets` (opens the add-sets
     modal; sets apply to source-backed skills, which is why this state still offers it).
   - Image group renders below whenever the image ships skills (D7).
3. Keep the state selection logic honest: stopped-with-snapshot → 06's panel;
   `hasRun === false` → never-run; running with content → normal surface; running without
   created skills and sources → empty. Starting/transition states keep whatever the
   surface does today (skeletons), untouched.

## Acceptance criteria

- [ ] A freshly created, never-started sandbox shows the scoped-down never-run panel; no
      copy anywhere promises install-before-start.
- [ ] Never-run sources list works (kebab included) and `Add source` round-trips.
- [ ] A running sandbox with no created skills and no sources shows both empty panels and
      still lists image skills; dropping a `.md` on the created panel uploads it.
- [ ] Both themes match the prototype renders (minus registered deviations).

## Smoke test

`mise run ui:check && mise run ui:test`. Dev cluster: create a sandbox, don't start it —
check the never-run panel and add/remove a source from it. Start it, remove all sources —
check the empty state, drop a `.md` file, and watch it appear under Created here.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
