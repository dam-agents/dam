# 02 — Tool activity preference

**Depends on:** 01-activity-group

**Part of:** Collapse an agent's tool activity into one group in chat — see [README](./README.md)

## Context

A user who wants to watch what the agent does should not reopen every group in every session.
A per-browser preference, "Tool activity", chooses whether activity groups start collapsed (the default) or expanded.
It is a plain UI preference, so it lives in localStorage like the theme and the sidebar sections, not in the server-stored experimental features.

## Implementation plan

Apply `/react-ui-engineering`.

1. **State**: in `packages/ui/src/modules/sessions/store/sessions.ts` add `toolActivityExpanded: boolean` and `setToolActivityExpanded(open)`, following `sessionsSectionOpen` / `setSessionsSectionOpen` in the same slice: read with `readPersistedFlag(TOOL_ACTIVITY_EXPANDED_STORAGE_KEY, false)` and write with `writePersistedFlag` (`packages/ui/src/lib/persisted-prefs.ts`).
   Put the storage key next to the other keys in that file.
2. **Group**: `ActivityGroup` (sub-issue 01) reads `toolActivityExpanded` from `useStore` and uses it as the initial open state.
   The running-turn behaviour from 01 stays: with the preference on, a group simply does not auto-collapse when the turn ends.
   Changing the preference affects groups mounted afterwards; already mounted groups keep their state, which is acceptable.
3. **Settings**: in the Appearance tab of `packages/ui/src/modules/settings/views/settings-view.tsx` add a "Tool activity" section under the theme picker: a short description ("What an agent did in a reply, folded into one group") and a switch or a two-option control (Collapsed / Expanded) bound to the store.
   Reuse the controls the settings tabs already use (see `FeaturesTab` in `packages/ui/src/modules/features/components/features-tab.tsx` for a switch row) rather than adding a new primitive.
4. Run `mise run //packages/ui:check`, `mise run //packages/ui:test` and `mise run check:comment-types`.

## Acceptance criteria

- [ ] Settings › Appearance shows a "Tool activity" control defaulting to collapsed.
- [ ] With the preference set to expanded, a reloaded session renders its activity groups open.
- [ ] With the preference set to collapsed, the same session renders them collapsed.
- [ ] The choice survives a page reload.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.

## Smoke test

Run `mise run //packages/ui:test` and `mise run //packages/ui:check`.
Then on the dev server open Settings › Appearance, set Tool activity to expanded, open a session with tool steps: groups are open.
Reload the page: still open.
Switch back to collapsed and reopen the session: groups are collapsed.
