# 06 — Add skill sets

**Depends on:** 04
**Part of:** search, bulk-toggle and skill sets — see [README](./README.md)

## Context

The slice that closes the issue: adding a saved set to a sandbox, so a new sandbox does not mean
re-picking from memory. 04 does the resolving and installing; this is its modal.

Apply the `/react-ui-engineering` skill.

## Implementation plan

1. **Pull the design first.** In the prototype from
   [#3208](https://github.com/dam-agents/dam/issues/3208), open the `Add skill sets` modal. Its details
   are decisions, not styling:

   - **Multi-select with checkboxes, not radios** — nothing here is mutually exclusive, and adding two
     sets is just the union of their skills.
   - Each row reads `N skills · a, b, c, +N`, then **what it adds on top of what is already on** —
     `adds 3`, or `already all on`. Picking should not be a guess.
   - An entry that cannot apply is called out on the row: `· K not in a connected source`, in the
     warning colour.
   - The footer counts the **union**, not the sets: two sets sharing `xlsx` add it once.
   - Empty state: no saved sets yet — save one from this sandbox first.
   - The header sentence states the additive guarantee plainly: their skills turn on alongside what you
     already have, overlap is fine, nothing gets turned off.

2. **Compute the preview client-side.** The surface already holds every source's scanned list and the
   installed refs, so `adds` and `not in a connected source` are derivable without a server round trip.
   That keeps the modal responsive while the user ticks boxes. The server recomputes the same thing at
   apply time and is authoritative — the preview is a preview.

3. **Component.** New
   `packages/ui/src/modules/sandboxes/components/skills/add-skill-sets-modal.tsx`, following the folder's
   existing modal shape and reusing `Checkbox` from `@/components/ui/`.

4. **Wire the action.** Add `applySets` to
   [`use-skills-surface.ts`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts).
   Set `installed` from the result's `installed` array, exactly as `toggle` does from its mutation
   result — the file's comment explains why the mutation result is authoritative between polls, and this
   is no different.

5. **Report what was skipped.** 04 returns a closed `reason` enum. Render the copy client-side per
   reason; never display the enum. A partial apply is a success with a caveat, not a failure: toast what
   installed, and name what did not and why. A set where **nothing** applied is the one case worth a
   plain error instead.

6. **Entry point.** The prototype puts `Add skill sets…` in the surface header beside
   `Save as skill set…`, and also offers it from the no-sources empty state ("or start from a set you've
   already built"). Add both. Hide while `readOnly`.

7. **Stopped and never-run sandboxes.** Applying a set starts a stopped sandbox, because
   `applyBatch` wakes the pod like every other skills mutation. Do **not** promise otherwise in the copy.
   The prototype's never-run panel says skills will be applied at first start — that describes a no-wake
   install path which does not exist and is out of scope for this feature. Keep the control hidden while
   the sandbox is not operable, matching the rest of the surface, and leave that panel to
   [#3208](https://github.com/dam-agents/dam/issues/3208).

## Acceptance criteria

- [ ] The modal lists the user's saved sets with their skill counts and a sample of names.
- [ ] Each row states how many skills it would add on top of what is on, or that everything is already on.
- [ ] A set with entries from a source this sandbox has not connected shows that count on its row.
- [ ] Several sets can be selected at once, and the footer counts the union — a skill in two sets is counted once.
- [ ] Applying installs only the missing skills and turns nothing off.
- [ ] A partial apply reports what installed and, in plain copy, what was skipped and why; the reason enum is never shown.
- [ ] A set where nothing could apply reports an error rather than a silent success.
- [ ] With no saved sets, the modal shows the empty state pointing at saving one first.
- [ ] The entry point appears in the surface header and in the no-sources empty state, and is hidden while the sandbox is stopped or starting.
- [ ] No copy anywhere claims skills will be applied at a later start.
- [ ] `mise run lint:fix` leaves the diff clean.

## Smoke test

```bash
mise run check && mise run test
```

Then on the dev cluster at `http://localhost:4444`:

1. Save a set from sandbox A (05). Create sandbox B, connect the same source, start it.
2. On B, open `Add skill sets`. The set's row reports how many it adds. Apply — those skills turn on
   and nothing else changes.
3. Open it again. The row now reads that everything is already on, and applying costs nothing.
4. Remove the source from B and open the modal. The row reports the entries as not in a connected
   source, and applying reports the error rather than claiming success.

Print a short manual smoke-test guide so the user can confirm it by hand.
