# 12 — The platform-artifacts skill: creation-time knowledge leaves the tool description

**Depends on:** 11-always-bound
**Part of:** Interactive Artifacts — see [README](./README.md)

## Context

The `interactive` param on `create_artifact` carries a ~200-word essay: the whole page API,
the small-asks pattern, payload economy, the sharing rationale. It rides every tool listing of
every session, used or not. A grilling session settled the extraction, and its decisions bind
this slice:

- **Split by moment, not by topic.** The skill carries creation-time knowledge only. The
  answer path cannot rely on a skill being in context: the binding chat is only _usually_ the
  chat that wrote the HTML (pin-at-first-ask edges), and compaction can drop a skill loaded at
  creation from the same chat's window. So `answer_artifact_request`'s description and the
  request prompt do not change — they are already short by design.
- **Distribution is the platform-schedules path.** A skill directory in
  `packages/platform-base/skills/`, copied by the base image into `.agents/skills/` — the
  pristine workspace seed. Claude Code is the only target; the codex image has no skills
  symlink and that is accepted.
- **The param becomes a pure pointer.** No duplicated API contract on the param — a backstop
  sentence would be a second place describing `platform.ask`, updated by a different reflex.
- **Named `platform-artifacts`**, the domain, not the feature: the pointer bakes the name into
  a live-served tool description, and the base `create_artifact` essay may move into the same
  skill later without a rename.
- **Existing agents get nothing and that is accepted.** The seed runs at first boot only. The
  feature is new and flag-off by default; the exposure is dev agents, recreated or patched by
  hand. Param shrink and skill ship in the same PR, so there is no intermediate state.
- **The flag gets a loud floor.** Today `create_artifact` accepts `interactive: true` with the
  flag off and only the answer tool is missing — a dead page with no error anywhere. The
  create handler refuses instead, and the skill's own gate line (feature is off when
  `answer_artifact_request` is absent) becomes belt-and-suspenders rather than load-bearing.

What this relocates, it does not remove: the skill's frontmatter `description` is loaded into
every session's skill listing and is the new trigger surface. It has to work as hard as
`platform-schedules`' does.

## Implementation plan

Apply the `/typescript-engineering` skill to the TS steps.

1. **The README moves first.** The pinned page-API block gains one line naming the skill as
   its carrier; the flag block gains the create refusal; the sub-issues table and order gain
   this slice. Done before code, per the plan's convention.

2. **The skill.** `packages/platform-base/skills/platform-artifacts/SKILL.md`. The base
   Dockerfile already copies `skills/` wholesale — no build change. Frontmatter `description`
   is trigger prose: publishing work for a human to see, and any page that must hand something
   back (a form to submit, choices to record, a Refresh button). Body, in order:
   - the gate line: if `answer_artifact_request` is not among the platform tools, interactive
     artifacts are off for this owner — build a static page and stop reading;
   - the page API, matching the README's pinned contract: `platform.ask(action, payload?)`
     awaited, resolution with the result, rejection with `{ reason, message }`,
     `platform.onState`, `platform.ready`;
   - the design guidance the param essay carried: many small asks, each rendering its own
     answer in place; send only what changed in `payload`; asks land in the conversation the
     page is bound to; interactive is settled at create and the page can never be shared;
   - one worked example (the Refresh-button page from the smoke test).

3. **The param shrinks to the pointer.** Three sentences on `create_artifact.interactive`:
   HTML only; set it when the page must hand something back, because a page without it can
   never reach you; permanent and never shareable; load the `platform-artifacts` skill before
   writing an interactive page. Nothing about `platform.ask` survives on the param.

4. **The flag refusal.** `registerArtifactLibraryTools` receives the session's
   `interactiveArtifacts` flag from the MCP endpoint (which already holds it), and the create
   handler refuses `interactive: true` when it is off, with a named message pointing at the
   feature flag. Handler-level, not service-level: the flag is a per-session MCP concern and
   the service stays flag-free.

5. **07 widens by one sentence.** The artifact-library architecture page documents the seeded
   skill as the creation-time knowledge carrier. `skills.md` needs nothing — the pristine-root
   convention already covers a platform-base skill.

Untouched, and asserted so: `answer_artifact_request`'s description, the request prompt, and
the one-clause additions on `update_artifact` and `set_artifact_sharing`.

## Acceptance criteria

- [ ] `packages/platform-base/skills/platform-artifacts/SKILL.md` exists; a fresh agent lists
      it as a system skill.
- [ ] The `interactive` param description is the three-sentence pointer and names
      `platform-artifacts`; `platform.ask` appears nowhere in any tool description.
- [ ] The skill's page-API section agrees with the README's pinned contract.
- [ ] `create_artifact` with `interactive: true` is refused when the `interactive-artifacts`
      flag is off, with a message naming the flag.
- [ ] `answer_artifact_request`'s description and the request prompt are unchanged from
      slice 11.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run check && mise run test`, then by hand on the dev cluster. Flag on, **fresh** agent
(the seed runs at first boot only): ask it to build an interview page mid-conversation and
confirm it loads `platform-artifacts` before calling `create_artifact`, and the page's asks
work end to end. Flag off, second agent: ask for an interactive page and confirm
`create_artifact` refuses loudly instead of publishing a dead page. In the Skills panel,
confirm the skill shows under system skills, not "Created in this agent".

The implementing agent runs this itself, then prints a short manual smoke-test guide.
