# 04 — Agent › Providers: every limit at a glance

**Depends on:** 02-binding, 03-meter
**Part of:** Provider spend limit for all agents — see [README](./README.md)

## Context

On the agent's Providers page, each provider shows what this agent may still spend on it today and
every limit behind that figure ([`mockup.html`](./mockup.html), section 3, variant A, "gap" style).
The limit dialog says which limit stops first before saving, and the agent's Usage card reads the
same server answer instead of computing it in the browser.

## Implementation plan

Apply **/react-ui-engineering**.

1. **Provider limit block** — rework `packages/ui/src/modules/spend/components/connection-spend-limit.tsx`.
   Read the agent's `binding` row for this Connection from `useAgentSpendStatus(agentId)`, the
   agent's `connection` limit and the owner's `owner-connection` limit from `status.limits`.
   - Title "Daily limit" + help tip ("What this agent may still spend on this provider today: the
     smaller of what its own limit and your limit for all agents have left."), the existing
     `SpendLimitButton` for the agent's own limit.
   - **Headline** (`text-[15px] font-semibold`): "‹left› left today", "Nothing left today" in danger
     when 0, or "‹spent› spent today · No limit" when no row. Under it, muted: "This agent's limit
     stops it first." / "Your ‹name› limit for all agents stops it first." (both set) / "…applies."
     (one set).
   - **One meter per limit**, stacked (`gap-3.5`): label line "This agent" / "All agents", with
     " · stops first" (`font-medium`) on the binding one when both exist; right side
     "‹spent› of ‹limit› · ‹left› left". Bar: the 03 meter track.
   - **"All agents" bar with the gap**: two segments in the state's fill, this agent's spend then
     the other agents', separated by a 2 px gap (`gap-0.5` on the flex track). Under it, muted
     small: "This agent ‹x›, other agents ‹y›". This agent's spend is
     `status.spentByConnection`; all agents' is `status.ownerSpentByConnection`.
   - **State line once**, below the meters: "Close to the limit." / "Limit reached. This agent's
     calls on ‹name› stop until ‹time› your time.", from the binding limit's state.
   - **Owner-wide dollars** (dollar Connections only): when the binding row of `connectionId: null`
     names `owner` or the ceiling and its state is warn/reached, a tinted message (`bg-warning/10
     text-warning-fg` or `bg-danger/10 text-danger`, `rounded-md px-2.5 py-2`): "Your spend limit
     (all agents) has ‹x› left today, less than this provider's limits." / "…is reached. Paid calls
     of all your agents stop until ‹time› your time." Same for the ceiling with its name. Never a bar.
   - Link line: "Your limit for all agents is set in Settings › Providers." or, without one,
     "Set a limit for all agents in Settings › Providers." (`Button variant="link"`,
     `navigateToSettings("providers")`). Reset line last.
   Split it into small components in `spend/components/` (headline, `LimitRowMeter`,
   `SharedLimitBar`, `OwnerWideNotice`) per **/react-ui-engineering**; keep copy in `lib/copy.ts`.
2. **Dialog line** — `components/spend-limit-dialog.tsx`: take an optional `compare` prop
   `{ spentMicros, otherLeftMicros, otherName } | null`. Under the field, show "‹spent› spent
   today." and, as the user types, one `aria-live="polite"` line: already reached → danger
   "This limit is already reached: ‹spent› spent today. Calls stop as soon as you save.";
   `otherLeft < amount − spent` → "‹otherName› has ‹x› left today, so it stops this agent first.";
   else "This limit stops this agent first: ‹x› left today." Never disables Save. The provider
   block passes the all-agents limit; the Settings › Providers block passes nothing but `spent`.
3. **Usage card** — `components/agent-spend-limit-card.tsx`: replace `nearerOwnerWideLimit` with the
   `connectionId: null` binding row; delete `lib/nearer-limit.ts`. `agent-limit-coverage-note.tsx`:
   the subscription and Bob are no longer "only" stopped by the agent's provider limit — say their
   limits are in Providers, for this agent or for all agents.
4. **Docs** — `docs/architecture/spend-limits.md` **Screens** → the agent's Providers section and
   the dialog. `/doc-drift`.

## Acceptance criteria

- [ ] Each of the six mockup states renders as in the mockup: both limits with either one binding,
      only the all-agents one, only the agent's, all-agents reached, no limits.
- [ ] The "All agents" bar is one colour with a 2 px gap at this agent's part, and its figures
      match `ownerSpentByConnection` and `spentByConnection`.
- [ ] The owner-wide notice shows only on dollar Connections, only when close or reached.
- [ ] The dialog's line updates while typing and never blocks Save.
- [ ] The agent's Usage card names the same stopping limit as `dam spend status <agent>`.
- [ ] `nearer-limit.ts` is gone; `mise run check` and `mise run test` pass.

## Smoke test

`mise run check` and `mise run test`.

Then on a local cluster: set agent A's Anthropic limit to $5 and the all-agents Anthropic limit to
$0.05; spend a little on A and on B. A's Providers page shows "Nothing left today" (or the small
amount left), "All agents · stops first", a gap between A's and B's part; raise the all-agents limit
to $20 in Settings › Providers and the headline switches to A's own limit. Open "Change" on A's
limit and type 0.01, 2 and 50: the line under the field changes accordingly.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
