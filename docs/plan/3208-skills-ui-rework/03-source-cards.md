# 03 — Source cards

**Depends on:** 01-page-shell-and-grouping
**Part of:** 3208 skills UI rework — see [README](./README.md)

## Context

The source card is the densest divergence from the prototype: header order, a standalone
refresh control with a visible scanning state, name-only rows, and a
`Show N more available` expand control. This slice also adds the one contract field of the
feature: scan-meta `visibility`, so the `Private` badge (header) and the drawer's
visibility chip (slice 05) can render (deviation D8). The error state is restyled, not
redesigned (D6).

## Implementation plan

Apply `/typescript-engineering` for step 1, `/react-ui-engineering` for the rest.

1. **Contract field.** In `packages/api-server-api/src/modules/skills/schemas.ts`, extend
   the scan-meta shape (the one carrying `scannedAt` on `listWithScan`) with
   `visibility: z.enum(["public", "private"]).optional()`. In
   `packages/api-server/src/modules/skills/services/skills-service.ts`, the list/scan
   dispatch sets it from the branch that served the scan: public-archive scanner →
   `public`; agent-runtime pod scan → `private`. Absent on old cache entries — the UI
   treats absent as unknown and renders no badge. No migration, no new procedure.
2. **Card header** (`components/skills/skill-source-card.tsx`), left to right per
   prototype: source name · `N of M on` count · `Private` badge (purple, only when
   `visibility === "private"`); below, the mono `gitUrl` (+ ` · /path` when the source has
   one). Right side: `scanned Xm ago` with clock glyph → refresh icon button (re-scan;
   spinner + `Scanning…` while in flight, then the refreshed time) → `Enable all`/
   `Disable all` bulk button (label flips when all are on — behavior exists) → kebab
   (Re-scan / View repo / Remove source — unchanged).
3. **Rows** (`components/skills/skill-row.tsx`): name (opens preview) — drop the
   description line; right side: `Update` drift affordance as a text link per prototype
   (keep the compare-URL behavior where it exists) → toggle. No kebab on source rows.
4. **Expand control**: replace `Expand all` / `Hide available` with
   `Show N more available` / `Hide available` where N is the collapsed count. Keep the
   branch's rule that search reaches collapsed rows and the user's own expand choice is
   preserved when a search clears.
5. **Error state**: keep `SourceError`'s verdict copy and Manage connections action;
   restyle container/typography to the new card (D6). Loading skeleton and
   "No skills in this source." row keep working.

## Acceptance criteria

- [ ] `listWithScan` exposes `visibility`; public GitHub sources report `public`, a
      pod-scanned private source reports `private`; absent → no badge (`mise run check`).
- [ ] Card header matches the prototype render (both themes), including scanning state.
- [ ] Rows are name-only with Update link + toggle; expand control shows the real count.
- [ ] Error, loading, and empty-source states all render inside the new card.
- [ ] Bulk enable/disable, per-skill toggle, re-scan, remove source unchanged
      (`mise run ui:test`, `mise run test` green).

## Smoke test

`mise run check && mise run ui:test`. Dev cluster: sandbox with one public and one private
source. Compare cards against prototype renders; trigger a re-scan and watch the scanning
state; break a source (revoke the connection) and confirm the restyled error + Manage
connections; `Show N more available` reveals exactly N rows.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
