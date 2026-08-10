# 03 — Bulk controls on the surface

**Depends on:** 02
**Part of:** search, bulk-toggle and skill sets — see [README](./README.md)

## Context

02 made a batch cost one apply cycle. This slice exposes it: a source card can turn all its skills on
or off in one action, and a sandbox with drifted skills can update them together instead of one pill
at a time. The issue names both.

Apply the `/react-ui-engineering` skill.

## Implementation plan

1. **Pull the design.** In the prototype from
   [#3208](https://github.com/dam-agents/dam/issues/3208), each source card header carries `Enable all`
   beside the `N of M on` count, and the drift banner above the groups carries `Update all` with the
   affected skill names in its sentence. Match that placement rather than inventing a toolbar.

2. **Hook surface.** In
   [`use-skills-surface.ts`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts),
   add two actions beside `toggle` and `update`:

   - `toggleSource(sourceId, on)` — install every not-installed skill of that source, or uninstall
     every installed one, in one `applyBatch` call.
   - `updateAll()` — re-install every drifted skill at its scanned version and hash, in one call.

   Follow the file's existing discipline exactly: it deliberately holds `state` in local state and
   sets it from the mutation result, because a recurring `skills.state` refetch lands inside the
   reconcile settle window and reverts an in-flight toggle. So set `installed` from `applyBatch`'s
   return value, and do not introduce react-query for these.

3. **Busy state.** `busyKey` is a single row key today, which cannot express "this whole card is
   working". Add a coarse busy marker for a source alongside it rather than overloading `busyKey` —
   the row spinner logic keys off exact matches and would misfire.

4. **Compute the delta client-side.** The surface already holds each source's scanned list and the
   installed refs, so `Enable all` is a set difference. Send only the difference, never the whole
   list: an install of an already-installed skill is a redundant row write and a redundant security-log
   line.

5. **Drift.** Drift is a scanned skill whose `contentHash` differs from the installed ref's — the same
   comparison `SkillRow` already makes for its `Update` pill. Reuse that predicate rather than writing
   a second one; if it is inline today, lift it to a shared helper so the banner and the row cannot
   disagree.

6. **Source card.** In
   [`skill-source-card.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-source-card.tsx),
   add the header control. It reads `Enable all` when some skills are off and `Disable all` when all
   are on. Hide it entirely while `readOnly` — administering skills is a running-agent action, which is
   how the surface already treats `Add source`.

7. **Drift banner.** Render it above the groups in
   [`skills-surface.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skills-surface.tsx),
   only when at least one skill is drifted, naming the affected skills as the prototype does. It
   disappears once the batch lands.

8. **Confirm a destructive bulk.** `Disable all` removes many skills at once. Route it through the
   existing `showConfirm` from the store, as the surface already does for deleting a standalone skill
   and removing a source. `Enable all` and `Update all` need no confirm — neither destroys anything.

9. **Interaction with search (01).** While a query is active, `Enable all` must act on the **whole**
   source, not the filtered subset — a control in a card header that silently means "the four you can
   currently see" is a trap. If that reads ambiguously on screen, hide the control while a query is
   active rather than changing what it means.

## Acceptance criteria

- [ ] A source card's header control installs every not-yet-installed skill of that source in one call, and reads `Disable all` once all are on.
- [ ] `Disable all` asks for confirmation before removing anything; `Enable all` and `Update all` do not.
- [ ] Only the difference is sent — enabling a source where two of six are already on installs four.
- [ ] A drift banner appears only when something is drifted, names the affected skills, and clears once updated.
- [ ] `Update all` re-installs every drifted skill at its scanned version in one call.
- [ ] The row-level `Update` pill and the banner agree on what counts as drifted, from one shared predicate.
- [ ] The card shows a busy state for the duration without the per-row spinner misfiring on unrelated rows.
- [ ] An in-flight bulk action is not reverted by the 5-second `skills.state` poll.
- [ ] Bulk controls are absent while the sandbox is stopped or starting.
- [ ] With a search query active, a bulk control either acts on the whole source or is hidden — never on the filtered subset.
- [ ] `mise run lint:fix` leaves the diff clean.

## Smoke test

```bash
mise run check && mise run test
```

Then on the dev cluster at `http://localhost:4444`: connect a source with several skills to a running
sandbox. Enable all — every skill turns on and the page settles once. Confirm on the pod (Files panel)
that each skill directory exists. Disable all — the confirm appears, and accepting removes them.
Then install one skill, push a change to that skill upstream, re-scan the source, and confirm the
drift banner appears and `Update all` clears it.

Print a short manual smoke-test guide so the user can confirm it by hand.
