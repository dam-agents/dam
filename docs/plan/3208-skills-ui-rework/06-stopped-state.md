# 06 — Stopped state

**Depends on:** 03-source-cards (restyled source list pieces)
**Part of:** 3208 skills UI rework — see [README](./README.md)

## Context

While stopped, the surface becomes a read-only snapshot: an info notice, a
"Skills at last run" chip panel, and a **live** Connected sources list (sources are
platform-side). Search, bulk actions, and toggles are left out, not greyed out. The data
shipped with #2654: `skills.state` returns `standaloneSnapshot: { capturedAt }` when
`standalone` came from the recording, and installed refs always come from Postgres.
The branch's `skills-surface.tsx` already has the readOnly branch to build on.

Render the prototype's Stopped state (both themes) first.

## Implementation plan

Apply `/react-ui-engineering`.

1. **Notice**: `Last known configuration, captured {relative time}` — from
   `standaloneSnapshot.capturedAt` — `— the sandbox is stopped, so this is a snapshot
   rather than live state. Start the sandbox to change its skills.` with a primary
   `Start sandbox` button wired to the existing start action. (The stale-model callout
   above it is slice 08.)
2. **Skills at last run** group (`as of {relative time}` in the head), a card of
   label/value lines with chips:
   - `On` → count of installed refs + standalone + image skills at snapshot time;
   - `Created here` → standalone snapshot names as chips;
   - one line per source with its installed skills as chips (installed refs carry
     `source`; group by the connected source's name, overflow as `+N`);
   - `With the image` → snapshot entries whose origin verdict is system (the snapshot
     records origin from the last live read — see `docs/architecture/skills.md`,
     Invariants).
   Below the card: `Search, bulk actions and per-skill toggles need the sandbox running —
   they're left out here rather than shown greyed out.`
3. **Connected sources** group: reuse slice 03's card header pieces in list form — name,
   Private badge, mono URL·path, `scanned Xm ago`, kebab (Re-scan / View repo / Remove
   source; they are platform-side and stay functional). `Add source` in the group head.
   Note below: `Sources and their scan times are platform-side, so they stay accurate and
   editable while stopped.`
4. Ensure no search field, drift banner, set buttons, or toggles render in this state, and
   that the surface's poll keeps cheap (it may keep reading `skills.state`; the stopped
   branch serves the snapshot).

## Acceptance criteria

- [ ] Stopped sandbox renders notice + chips + live sources per the prototype, both themes.
- [ ] Chip groups derive from `standaloneSnapshot` + installed refs + origin verdicts; a
      sandbox with no snapshot never reaches this panel (that is never-run, slice 07).
- [ ] Source kebab actions work while stopped; skill-level interactions absent.
- [ ] Relative times render from `capturedAt` and each source's `scannedAt`.

## Smoke test

`mise run ui:check && mise run ui:test`. Dev cluster: open a running sandbox's Skills page
(populates the snapshot), stop the sandbox, reload — compare against the prototype's
Stopped render. Re-scan a source while stopped and watch `scanned … ago` refresh. Confirm
no toggle or search is reachable. (Visiting the page can wake a stopped sandbox via source
scans — stop it again if needed and avoid triggering scans while checking.)

The implementing agent runs this itself, then prints a short manual smoke-test guide.
