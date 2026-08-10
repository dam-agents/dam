# 01 — Search across every connected source

**Part of:** search, bulk-toggle and skill sets — see [README](./README.md)

## Context

Finding a skill today means expanding every source card and reading truncated descriptions. This
slice adds one search box over everything the page has already loaded. It is UI only — the surface
scans every source eagerly on mount, so no procedure is involved.

Apply the `/react-ui-engineering` skill.

## Implementation plan

1. **Pull the design.** Fetch `issue-3022-prototype.html` from
   [#3208](https://github.com/dam-agents/dam/issues/3208) and read the Running panel: the search input
   sits above the groups, and the counts line beneath it becomes the match report while a query is
   active. Match its copy and placement.

2. **Hold the query in the surface.** In
   [`skills-surface.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skills-surface.tsx),
   add local query state. Keep it in the surface rather than the hook —
   [`use-skills-surface.ts`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts) owns
   server state and its polling contract, and a text box does not belong in it.

3. **Search input.** Use the existing `Input` from `@/components/ui/input`, with the search icon from
   `@carbon/icons-react`. Placeholder per the prototype ("Search skills across all connected
   sources…"). Render it only when there is something to search — not in the `isEmpty` state.

4. **Filter all three groups.** Matching is case-insensitive over **name and description**, per the
   issue. Derive filtered values in `useMemo`, and leave the source data untouched:

   - `createdHere` and `builtIn` — filter the `standalone`-derived arrays.
   - Source cards — pass each card its filtered skill list.

   A source whose matches are all filtered out should disappear from the list while a query is
   active, rather than showing an empty card.

5. **Reach collapsed rows.** `SkillSourceCard`
   ([`skill-source-card.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-source-card.tsx))
   collapses not-installed skills behind an expand control and snapshots its collapse default once
   `stateLoaded` flips. A match hidden behind that control is a search that looks broken, so the card
   must expand while a query is active and return to the user's own collapse state when the query
   clears. Drive this from a prop rather than reaching into the card's state.

6. **Counts line.** Add the header line the prototype shows — total skills, connected source count,
   and how many are on. While a query is active it reads as the match count instead. This line is
   where search reports "no matches", so it is not optional decoration.

7. **Empty result.** A query matching nothing shows a short "no skills match" line, not the
   "add a source" empty state — the sandbox is not bare, the filter is just narrow.

## Acceptance criteria

- [ ] Typing filters skills from every connected source plus the created-here and image-shipped groups, matching name and description, case-insensitively.
- [ ] A match inside a collapsed source card is visible without the user expanding anything.
- [ ] Clearing the query restores the previous collapse state of every card, including one the user had expanded by hand.
- [ ] A source with no matches is hidden while a query is active, rather than rendering an empty card.
- [ ] The header reports total skills, source count and how many are on; while searching it reports the match count.
- [ ] A query matching nothing shows a no-matches line, not the "add a source" empty state.
- [ ] No new procedure, and no change to `use-skills-surface.ts`'s polling or mutation behaviour.
- [ ] While the sandbox is stopped the surface stays read-only, matching today's behaviour.
- [ ] `mise run lint:fix` leaves the diff clean.

## Smoke test

```bash
mise run check && mise run test
```

Then on the dev cluster at `http://localhost:4444`: connect a source with many skills to a running
sandbox, collapse its card, and search for a skill you know is not installed. It appears. Clear the
query and confirm the card collapses back. Search for a nonsense string and confirm the no-matches
line rather than the empty state.

If the page looks stale, check the served bundle first — the service worker caches an old one after
`build-ui`.

Print a short manual smoke-test guide so the user can confirm it by hand.
