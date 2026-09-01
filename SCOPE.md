# Packs — scope and open questions

Status: **design prototype** on `design/home-prototype`.
Do not merge. Do not open a PR.

## What exists today (UI-only prototype)

| Feature | Status | Notes |
|---------|--------|-------|
| Left-rail nav item | Done | `Categories` icon, routes to `/packs` |
| Packs list page | Done | `PageHeader`, pill `Tabs` (All / Development / Knowledge / Monitoring / Research), search, card grid |
| Pack detail modal | Done | `Modal` with focus trap, scroll lock, ingredients split into Included / You'll need, video placeholder |
| 6 honest fixtures | Done | Only real primitives: harnesses, frameworks, connections, channels, schedules, skills, knowledge bases, starter repos |
| Data model | Done | `PackIngredientKind` (9 kinds), `PackSlot` with `demoValue`, `connectionTemplateId`, `Pack` with `included[]` / `required[]` |
| Setup-flow entry point | Done | "Browse packs" callout in the create-agent form |
| Flow A: Create from pack | Done | Pack detail → prefilled setup form → Create agent → chat with summary message |
| Flow B: Try it demo | Done | Demo agent on real surfaces, seeded chat, Demo badge, three exit paths |
| PacksSlice store | Done | `pendingPack`, `demoAgents` map, actions to set/clear |
| Name generation | Done | `nextNameWithPrefix` produces `code-reviewer-1`, `design-prototyper-2`, etc. without widening `SandboxNameKind` |

## Ingredient prefill table

What travels from a pack to the setup form today vs what needs more work:

| Ingredient | Setup prefill? | Notes |
|------------|---------------|-------|
| Harness (templateId) | Yes | Matched from `PackSlot.templateId` |
| Connections | Yes | Matched by `connectionTemplateId` against user's existing connections |
| Schedules | Yes | Built from `demoValue` cron → `ScheduleDraft` via `cronToRRule` |
| Name | Yes | Auto-generated from pack slug via `nextNameWithPrefix` |
| Skills | No | Needs `skillSetApplyInputSchema` call after create — mock skips this |
| Knowledge bases | No | No create-time API; shows in "Still needed" summary message |
| Channels | No | No create-time API; shows in "Still needed" summary message |
| Starter repos | No | `starterRepoUrl` field exists on PackSlot but not wired |
| Frameworks | No | Hidden by `imageCatalogue()` filtering |

## Known bugs and limitations

### `scheduleDrafts` silently discarded on create

`use-setup-form.ts` stores `scheduleDrafts` and `ScheduleSetupSection` renders them in the form. But `buildCodingAgentSetupInput` in `create-agent-input.ts` never reads them — there is no `schedule` field on `CreateAgentInput`. Schedules drafted during setup are silently lost when the real create endpoint fires. The mock path (`mockCreateAgentFromPack`) bypasses this by seeding directly, but real creates will lose any pack-prefilled schedules.

### `SandboxNameKind` is a closed union

The 5-string union (`codingagent-`, `experiment-`, etc.) cannot be widened for pack-derived names. `nextNameWithPrefix` is a standalone function that takes any prefix string, used exclusively by the pack flow. The existing `nextSandboxName` delegates to it internally.

### `seedDemoCaches` is a no-op stub

`create-demo-agent.ts` calls `seedDemoCaches` after inserting the demo agent, but the function body is empty. Demo agent settings pages (schedules, skills, connections) won't show populated data yet — only the chat is seeded.

## Demo agent design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Demo agent ID | `"demo-" + pack.id` (stable) | Second "Try it" press returns to existing demo, no duplicates |
| Demo agent `state` | `"running"` | Needed to suppress `AgentUnavailableOverlay` in chat view |
| Demo in agents list | Shown with Demo badge | Agents list reads from query cache; demo agent is inserted there |
| Demo overlay suppression | `!agentOperable && !isDemo` guard | Prevents overlay from blocking demo agent chat |
| Exit: Make this mine | Clears demo flag, keeps agent | Agent stays in list as a normal agent |
| Exit: Back to packs | Keeps demo for re-entry | Navigate to packs view, demo stays in cache |
| Exit: Walk away | Removes agent from cache | Clean teardown, returns to packs |

## What needs server work

- **Apply-to-existing-agent endpoint**: No API to apply a bundle of settings to an existing agent atomically. Today you can only set individual fields (template, connections, skill sets) one at a time.
- **Pack registry / catalog API**: Packs are currently static fixtures. A real implementation needs a server-side catalog, potentially user-authored packs, versioning decisions, etc.
- **Partial-apply result**: The `skillSetApplyResult` schema (installed / added / skipped with reasons) is the precedent, but extending it to a full pack apply result (connections skipped because already present, schedule collisions, etc.) needs new types.
- **Framework surfacing**: The 7 preconfigured templates (NOUS, OpenEvolve, etc.) are hidden by `imageCatalogue()` filtering. Packs that use frameworks need a way to surface them in the harness picker.
- **Schedule creation on agent create**: `CreateAgentInput` has no `schedule` field. Schedules must be created as a separate step after the agent exists.

## Open questions

1. **Can packs be user-authored?** The current model is static presets. If users can create and share packs, the data model needs ownership, visibility, and storage.
2. **Apply semantics**: The spec says additive-only, never silently overwrite. But what happens when a pack sets a schedule cron that conflicts with an existing one? Show both? Rename?
3. **Make-this-mine flow**: After demo, the user keeps the agent but needs to fill in real values for missing slots. Currently this just clears the demo flag — no guided slot-filling yet.
4. **Pack versioning**: The spec says "a pack is a one-time preset, not a live link." If the catalog changes, does an already-applied pack update? Current answer: no.
5. **Demo cache seeding**: `seedDemoCaches` is a stub. Should demo agent settings (schedules, skills, connections panels) show populated fixture data, or is the chat seed sufficient for the prototype?
