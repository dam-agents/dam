# 02 — UI: render "scanned X ago" on the source card

**Depends on:** 01-api-server-contract
**Part of:** Show when a skill source was last scanned — see [README](./README.md)

## Context

Consume the widened `skills.list` response and render the freshness timestamp on each GitHub source
card, exactly as the design shows: a muted `scanned 2h ago` right-aligned in the card header,
immediately left of the `⋯` kebab. A never-scanned or errored source shows nothing. Because
`refreshSource` re-calls `loadSkills`, a Re-scan updates the timestamp to `scanned just now` with no
extra wiring.

Apply the [`/react-ui-engineering`](../../../packages/ui/CLAUDE.md) skill; run `mise run lint:fix`
after edits.

**Base note:** #3139 has merged and touched both files below, but not the parts this slice edits —
it added a `suppressedNames` prop to `SkillSourceCard` (filtering `list` before the `N of M on`
count derives) and `prState` fields to an optimistic publish record in `use-skills-surface.ts`.
Neither interacts with the timestamp: this slice reads `scannedAt` per source, never per skill.
Line numbers below drift by a few lines against `main`; anchor on the named symbols, not the
numbers.

## Design (from the Figma source-card frame)

- **Copy:** `scanned {timeAgo}` — lowercase `scanned` + the existing `timeAgo` output, e.g.
  `scanned 2h ago`, `scanned just now`.
- **Placement:** right-aligned in the header's action cluster, **before** the kebab (the `N of M on`
  counter stays next to the source name on the left — it does not move).
- **Style:** `text-sm text-muted-foreground` — the same muted treatment as the counter and repo URL.
- **Hover:** absolute time via `title={formatTimestamp(scannedAt)}` (the codebase idiom: relative
  in the label, absolute on hover).
- **Empty rule:** shown only when `!error && scannedAt` — nothing for a never-scanned or errored
  source.

## Implementation plan

### 1. Hook stores the timestamp — [`use-skills-surface.ts`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts)

- Return-type interface (line ~30, beside `skillsBySource` / `loadingBySource` / `errorBySource`):
  add `scannedAtBySource: Record<string, string>;`.
- State (line ~102, mirroring the sibling `*BySource` records):
  `const [scannedAtBySource, setScannedAtBySource] = useState<Record<string, string>>({});`.
- `loadSkills` (line ~124): the query now returns a wrapper. Destructure it:
  ```ts
  const { skills, scannedAt } = await api.skills.list.query({ sourceId, agentId });
  setSkillsBySource((s) => ({ ...s, [sourceId]: skills }));
  setScannedAtBySource((m) => ({ ...m, [sourceId]: scannedAt }));
  ```
  On the `catch` path, leave `scannedAtBySource` untouched — the card's `!error` guard hides the
  timestamp while an error is shown, and a later successful load overwrites it.
- `removeSource` (line ~361): mirror the existing `skillsBySource` cleanup — also drop the
  `scannedAtBySource[id]` entry so a removed source leaves no stale timestamp.
- Return object (line ~455): expose `scannedAtBySource`.

### 2. Surface threads the prop — [`skills-surface.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skills-surface.tsx)

- Destructure `scannedAtBySource` from `useSkillsSurface(...)` (line ~74, next to `skillsBySource`).
- On the `<SkillSourceCard>` render (line ~247), add `scannedAt={scannedAtBySource[src.id]}`
  alongside the existing `skills={...}` / `loading={...}` / `error={...}` props.

### 3. Card renders it — [`skill-source-card.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-source-card.tsx)

- Import the formatters: `import { timeAgo, formatTimestamp } from "@/lib/format-time";` (the card
  already imports from `@/lib/...`).
- Props (the inline type, line ~97): add
  ```ts
  /** ISO 8601 time the source's skill list was last scanned; absent until a
   *  successful scan. Rendered as "scanned X ago"; hidden while errored. */
  scannedAt?: string;
  ```
  and destructure `scannedAt` in the function parameter list (line ~81).
- In the header's right-side action cluster (`<div className="flex shrink-0 items-center gap-2">`,
  line ~174), **before** `{loading && <Spinner size={15} />}` and the kebab, add:
  ```tsx
  {!error && scannedAt && (
    <span
      className="shrink-0 text-sm text-muted-foreground"
      title={formatTimestamp(scannedAt)}
    >
      scanned {timeAgo(scannedAt)}
    </span>
  )}
  ```
  Leave the existing `{enabled.length} of {list.length} on` counter (line ~166) where it is — it
  belongs to the left-hand name block, not this cluster.

Then `mise run lint:fix` (fixes import order / `import type`).

## Acceptance criteria

- [ ] The hook exposes `scannedAtBySource`; `loadSkills` populates it from the query's `scannedAt`.
- [ ] A successfully-scanned GitHub source card shows a muted `scanned <time> ago`, right-aligned
      immediately left of the kebab; hovering shows the absolute timestamp.
- [ ] A never-scanned or errored source shows **no** timestamp.
- [ ] Re-scan (kebab) updates the label to `scanned just now` after the spinner resolves.
- [ ] The `N of M on` counter and the standalone "created in this sandbox" group are unchanged.
- [ ] `mise run check` and `mise run lint:fix` are clean.

## Smoke test

This slice completes the feature, so its smoke test is the whole-feature check. On the local k3s
dev cluster (`cluster-ops` skill), served over **`http://localhost:4444`**:

1. `mise run check` — the UI must typecheck against the widened `skills.list` (a stale response type
   here means slice 01 wasn't rebuilt into the running api-server; see below).
2. Open a sandbox → **Skills**. Each **SOURCED FROM GITHUB** card shows `scanned <time> ago`
   right-aligned before the kebab; hover shows the absolute time. The `N of M on` counter is
   unchanged.
3. Kebab → **Re-scan** → spinner → label becomes `scanned just now`.
4. A source whose scan errors shows the error banner and **no** timestamp.

If a card renders blank or omits the timestamp, suspect a **stale api-server** (zod `.output()`
silently strips a field an older api-server doesn't send) — rebuild slice 01 into the cluster with
`mise run cluster:build-apiserver`, not a UI guard. Watch the **service-worker stale bundle** (verify
the loaded script matches the served one) and the cross-worktree **vite port collision**
(localhost:5173 may serve another branch) before concluding a change didn't apply.

The implementing agent runs `mise run check` + `mise run lint:fix` itself, then prints this manual
guide for the user to confirm on the cluster.
