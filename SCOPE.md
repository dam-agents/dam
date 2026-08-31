# Packs — scope and open questions

Status: **design prototype** on `design/packs-page`.
Do not merge. Do not open a PR.

## What exists today (UI-only prototype)

| Feature | Status | Notes |
|---------|--------|-------|
| Left-rail nav item | Done | `Categories` icon, routes to `/packs` |
| Packs list page | Done | `PageHeader`, pill `Tabs` (All / Development / Knowledge / Monitoring / Research), search, card grid |
| Pack detail modal | Done | DAM `Modal` with focus trap, scroll lock, ingredients split into Included / You'll need, video placeholder |
| 6 honest fixtures | Done | Only real DAM primitives: harnesses, frameworks, connections, channels, schedules, skills, knowledge bases, starter repos |
| Data model | Done | `PackIngredientKind` (9 kinds), `PackSlot` with `demoValue`, `Pack` with `included[]` / `required[]` |
| Setup-flow entry point | Done | "Browse packs" callout in the create-agent form |
| Retired-word fixes | Done | "sandbox" → "environment" in agents-view, "image" → "harness" in setup subtitle |
| Dead code cleanup | Done | Deleted `agent-type-section.tsx`, `framework-section.tsx` (zero references) |

## What's applyable today (no server work)

These could be wired up with only UI-side changes:

- **Pre-fill the create-agent form**: Clicking "Create agent with this pack" could navigate to `/agent-new` with the harness template ID and connection IDs pre-selected in the setup form's Zustand store.
- **Skill set creation**: The `skillSetApplyInputSchema` already supports creating a skill set by name + sources. A pack's skills could be saved as a skill set on apply.
- **Schedule drafts**: The `ScheduleSetupSection` already accepts `scheduleDrafts`. A pack could pre-fill those.

## What needs server work

- **Apply-to-existing-agent endpoint**: No API to apply a bundle of settings to an existing agent atomically. Today you can only set individual fields (template, connections, skill sets) one at a time.
- **Pack registry / catalog API**: Packs are currently static fixtures. A real implementation needs a server-side catalog, potentially user-authored packs, versioning decisions, etc.
- **Partial-apply result**: The `skillSetApplyResult` schema (installed / added / skipped with reasons) is the precedent, but extending it to a full pack apply result (connections skipped because already present, schedule collisions, etc.) needs new types.
- **Framework surfacing**: The 7 preconfigured templates (NOUS, OpenEvolve, etc.) are hidden by `imageCatalogue()` filtering. Packs that use frameworks need a way to surface them in the harness picker.

## Open questions

1. **Can packs be user-authored?** The current model is static presets. If users can create and share packs, the data model needs ownership, visibility, and storage.
2. **Apply semantics**: The spec says additive-only, never silently overwrite. But what happens when a pack sets a schedule cron that conflicts with an existing one? Show both? Rename?
3. **Demo mode**: `PackSlot.demoValue` is defined but not rendered in a demo state yet. The spec envisions a mode where you can see the pack running with illustrative values before committing.
4. **Make-this-mine flow**: After demo, the user fills in real values for slots. This needs a form that walks through unfilled required slots.
5. **Pack versioning**: The spec says "a pack is a one-time preset, not a live link." If the catalog changes, does an already-applied pack update? Current answer: no.
