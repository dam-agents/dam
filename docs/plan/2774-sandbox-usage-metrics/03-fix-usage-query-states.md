# 03 — Stop the Usage tab flashing a skeleton on every month change

**Depends on:** 02-share-month-period-plumbing
**Part of:** Sandbox-level usage metrics — see [README](./README.md)

**Fixes:** https://github.com/ibm/dam/issues/3148

## Context

Settings › Usage flashes its whole four-section skeleton every time the month changes, and on a
deployment without the telemetry store it flickers skeleton → *unavailable* on each change while
firing a request that cannot succeed.

This is pre-existing, not introduced by this feature — but slice 04 adds a **second** surface with
the same branching, and the whole point of reusing the global view's components was that both
surfaces behave alike. Fixing it here means slice 04 inherits the correct behaviour instead of
copying the wart.

Two independent defects:

1. **Cache-miss skeleton.** The query is keyed on the month range, so stepping the month is a fresh
   key with no data: `isPending` goes true and the skeleton replaces figures that are already on
   screen. Every month change, on every deployment.
2. **Non-sticky unavailable state.** `PRECONDITION_FAILED` means *this deployment has no telemetry
   store* — a deployment-level fact, invariant across months. The view re-derives it per month, so
   each change costs a doomed round-trip and a skeleton flash on the way back to the same message.

Apply the **`/react-ui-engineering`** skill.

## Implementation plan

1. **`packages/ui/src/modules/metrics/api/queries.ts`** — add `placeholderData: keepPreviousData`
   (imported from `@tanstack/react-query`) to `useSpendBreakdown`. The previous month's rows stay on
   screen while the next month resolves, so `isPending` is only ever true on the genuine first load.

   Callers must now distinguish "showing stale data" from "showing this month's data" — expose
   `isPlaceholderData` so the view can dim the figures in flight rather than silently presenting last
   month's numbers under this month's label. Dimming, not hiding: a brief `opacity` transition on the
   content, no layout change.

2. **Make the unavailable verdict sticky.** The deployment either has a store or it doesn't, so the
   view should decide once and stop asking per month.

   Prefer deriving it from the error already in hand over adding a second query: once
   `useSpendBreakdown` reports an error whose tRPC code is `PRECONDITION_FAILED`, that verdict holds
   for the session. Hold it in the metrics module — a tiny module-scoped flag or a `useRef`-backed
   hook such as `useMetricsUnavailable(error)` — and when it is set, render the unavailable card
   **in place of the whole tab** rather than below the period control, and skip the query
   (`enabled: false` / `skipToken`) so no further doomed requests fire.

   Keep the two states distinct, which is the whole reason the backend fails closed: *unavailable*
   (no store on this deployment) must not look like *empty* (store present, no rows this month).

3. **`packages/ui/src/modules/metrics/views/usage-view.tsx`** — apply both above. The month switcher
   is meaningless once metrics are unavailable, so the unavailable branch replaces the header actions
   too; check that `PageHeader` tolerates an omitted `actions`.

Do not fold this into slice 02 — that slice is a behaviour-preserving refactor, and mixing a fix into
it would destroy its "the global page is provably unchanged" verification.

## Acceptance criteria

- [ ] `mise run check` (scoped: `ui:check`) and `mise run ui:test` pass.
- [ ] On a deployment **with** a store, stepping the month keeps the previous month's figures visible,
      dimmed, until the new month lands — no four-section skeleton, no layout jump.
- [ ] The skeleton still appears on the genuine first load, when there is nothing to keep.
- [ ] On a deployment **without** a store, the unavailable message appears once and stays: no
      skeleton flash, and the month switcher is gone rather than inert.
- [ ] Exactly **one** `spendBreakdown` request is issued on such a deployment, however many times the
      month would otherwise change.
- [ ] *Unavailable* and *empty month* remain visually distinct.
- [ ] Figures are never shown under the wrong month's label without the in-flight dimming.

## Smoke test

Verifiable on the current dev deployment, where the store is disabled — this slice's main symptom is
exactly what is on screen today.

1. `mise run ui:check && mise run ui:test` — both green.
2. In the dev server on `localhost:5173`, open Settings › Usage with the Network tab filtered to
   `spendBreakdown`:
   - **before** this slice: one request per month change, each preceded by a skeleton flash;
   - **after**: a single request total, the unavailable card rendered once, and no way to trigger
     another (the switcher is gone).
3. With a store available (see the README's note on `CLICKSTACK=1 mise run cluster:helm`), step the
   month back and forth and confirm the figures dim rather than collapsing to a skeleton. If no store
   is available, record this check as outstanding rather than passing it.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can
confirm it by hand.
