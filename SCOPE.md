# Scope — Packs page design task

Branch `design/packs-page`, pinned at `9abbdbe1`. Read this before implementing anything
off this branch.

A pack is a **one-time preset**. Applying it copies a configuration onto an agent and the
relationship ends — no versioning, no update prompts, no revert. Applying is **additive**:
it never overwrites what the agent already has, and an unmet requirement never blocks it.

Run it with `pnpm --filter ui exec vite --config vite.proto.config.ts` (port 5410). It is
fixtures only — no api-server, no Keycloak, no database.

## In scope

The Packs page, the pack detail dialog, the demo, and the two entry points that reach
packs. Nothing else on the page was touched.

## What changed, per file

| File | Change |
|---|---|
| `modules/packs/data/packs.ts` | Six packs rebuilt from ingredients DAM actually has. Added the `PackSlot` type, `ingredientCounts()`, per-kind icons and singular/plural labels. |
| `modules/packs/views/packs-view.tsx` | Card grid with counted ingredients, facet filter, empty / filtered-empty / loading states, and `previewApply()`. |
| `modules/packs/components/pack-detail-sheet.tsx` | Included / You'll need / docs link / setup note. Primary button works even with an unmet requirement. |
| `modules/packs/components/apply-pack-modal.tsx` | New. Apply preview and apply result, three sections: added, left alone, yours to fill in. |
| `modules/packs/components/pack-demo-view.tsx` | New. The throwaway demo agent, badged Demo, running on sample content. |
| `modules/packs/components/make-mine-modal.tsx` | New. Demo converting to the user's agent; each sample slot becomes a thing to fill in. |
| `components/list-skeleton.tsx` | Optional `className`, so a grid page's skeleton matches its grid. Default is unchanged, so the other callers are untouched. |
| `app.tsx` | `PacksRoute` — packs opened from an agent applies to that agent instead of creating one. |
| `modules/platform/store/navigation.ts` | `applyPackTo` state + `browsePacksFor()`. |
| `modules/sandboxes/components/sandbox-setup-section.tsx` | "Apply a pack" on an existing agent's setup page. |
| `modules/agents/components/welcome-entry-points.tsx` | "Browse packs" beside "Create an agent". |

Fixed on the way past, both named in the prompt as reading like bugs:

| File | Change |
|---|---|
| `modules/agents/views/agents-view.tsx` | Empty state no longer offers the four agent types, which are gone. |
| `modules/agents/lib/create-agent-input.ts` + its two views and unit test | `CodingAgentSetupDraft` → `AgentSetupDraft`, `isCodingAgentSetupComplete` → `isAgentSetupComplete`, `buildCodingAgentSetupInput` → `buildAgentSetupInput`. Rename only; no behaviour change. |

Deleted, unreferenced on this branch and contradicting the single-setup decision:
`modules/agents/components/agent-type-section.tsx` (the four-type picker, with inline
GitHub/Slack SVGs and a hardcoded `"Nous, OpenEvolve, +3 more"` badge) and
`modules/agents/components/framework-section.tsx`. Neither is kept as reference.

## What did NOT change

Agent setup's own fields, the sessions sidebar, chat, artifacts, knowledge bases,
experiments, platform settings. `agent-setup-view.tsx` gained one callout and the rename;
its form is otherwise as it was.

## Applyable today vs needs server work

Per ingredient kind, against `agentCreateInputSchema`, `TemplateSpec` and the skills and
schedules routers as they stand at the pin.

**A pack can set these up now, with calls that already exist:**

| Kind | How |
|---|---|
| Harness | `templateId` on `agents.create` |
| Framework | also `templateId` — the framework images are real templates. `imageCatalogue()` filters them out of the picker, so today chat is the only place a user meets one. |
| Starter repo | `gitRepo: { url, ref }` on `agents.create` |
| Skill | `skills.install`, or `skills.sets.applyToAgent` for a set |
| Schedule | `schedules.createCron` / `createRRule` after the agent exists — the pack has to carry the prompt text |
| Hibernation timeout | `hibernationTimeoutMin` on `agents.create` |

**These are NOT seedable and are modelled as slots the user fills in:**

| Kind | Why |
|---|---|
| Connection | `connectionIds` grants connections the user **already** has. Creating one needs their OAuth consent or their secret, so a pack can never supply it. |
| Channel | `agents.connectSlack` needs a channel id. Which channel is the user's choice, and the binding is the authorization. |
| Knowledge base | No seeding path, and the content is the user's anyway. |
| Artifact | Produced by the agent at runtime. Nothing to seed — the pack only promises the agent will write them. |

This is why the apply preview has a **"Yours to fill in"** section and never lists a slot
under "Will be added". A preview that promised a repo or a channel would be promising
something apply cannot do.

**Also needs server work:** packs themselves. `data/packs.ts` is a hardcoded UI constant.
There is no pack resource, no pack API, and no way for anyone to author one. The demo
(§4.5) needs a throwaway-agent lifecycle that does not exist either.

Partial apply mirrors `skillSetApplyResult` — `{ installed, added, skipped[] with reason }`
is DAM's existing precedent for "some of it landed", so the result screen should not need a
new shape.

## Open questions — for the design lead, not decided here

1. **What a demo agent costs.** The demo assumes a throwaway agent per user, per pack. Whether
   that is affordable is unknown; the design assumes it is and returns to it. On Thursday's
   dev-review list.
2. **Whether a knowledge base stays its own destination.** `knowledge-base-setup-view.tsx`
   and `experiment-setup-view.tsx` still exist and are still reachable in code, while the
   agent types they belong to are gone. Either they are removed, or they are "apply a pack"
   paths in disguise. Someone arriving wanting a wiki would not know to click "Create
   agent" to get one — so this is a flow question, not a cleanup. **Flagged, not resolved.**
3. **Which included ingredients collide** on apply. The prototype stands the first one in as
   a collision so the state is reachable; the real answer is the server's.

## Don't implement

Invented to make the prototype run. None of it is a design decision.

- `proto.html`, `vite.proto.config.ts`, `tsconfig.proto.json` — the prototype's own entry
  point, dev server and typecheck. They exist because the monorepo tsconfig extends an
  uninstalled package.
- `src/mock/packs-states.tsx` and the `/proto/packs-states` path — reaches the empty and
  loading states, which the fixtures cannot express because the pack list is static.
- `src/mock/auth.ts` and the mock fixture data, including the widened
  `src/mock/data/connections.ts` template ids. The ids there now match the real ones
  (`github`, `slack`, `modal`, `kubernetes`) so slot matching can be driven; that file is a
  fixture, not a schema.
- `previewApply()`'s first-included-item-collides rule in `packs-view.tsx`.
- Every `demoValue` string, and every message in `pack-demo-view.tsx`. Sample content for a
  screenshot — the wording is not copy to ship.
- `docsUrl` on the optimization pack. A plausible URL so the link renders.

Where a string **is** a design decision — the apply-preview headings, the slot lines, the
demo badge, the empty states, the button labels — it is deliberate and short on purpose.
Cutting words changes what the screen means, so a wording change is the design lead's call.

## Verification

13 states driven headless against the running prototype
(`/home/agent/shot/packs-drive.mjs`), each asserted on DOM content rather than on the page
having rendered — a failed query in this app keeps its last good data and renders perfectly.
Checks include: no banned vocabulary, no emoji, the loading skeleton's measured geometry
against the real cards, a slot never appearing above "Yours to fill in", and the exact
partial-apply count. Typecheck via `tsconfig.proto.json` with the same aliases as vite: no
errors in any file this task touched. The 8 remaining errors are pre-existing at the pin
(`mock/browser.ts`, `mock/handlers.ts` — msw not installed here; `sessions/terminal.tsx` —
`SharedArrayBuffer`), all three files byte-identical to `9abbdbe1`.

`mise run ui:fix`, `ui:check:tsc` and `ui:test` could not run in this worktree — pnpm is
broken here and `node_modules` is a symlink. **Run them before merging.** Import order and
formatting were matched by hand, so treat a formatter diff as expected.
