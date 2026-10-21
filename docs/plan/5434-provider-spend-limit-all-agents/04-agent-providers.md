# 04 — Agent › Providers: every limit at a glance

**Depends on:** 02-binding, 03-meter
**Part of:** Provider spend limit for all agents — see [README](./README.md)

## Context

On the agent's Providers page, each provider shows what this agent may still spend on it today and
every limit behind that figure ([`mockup.html`](./mockup.html), section 3, trimmed).
The limit dialog says which limit stops first before saving, and the agent's Usage card reads the
same server answer instead of computing it in the browser.

## Implementation plan

Apply **/react-ui-engineering**.

1. **Provider limit block** — rework `packages/ui/src/modules/spend/components/connection-spend-limit.tsx`.
   Read the agent's `binding` row for this Connection from `useAgentSpendStatus(agentId)`, the
   agent's `connection` limit and the owner's `owner-connection` limit from `status.limits`.
   The card is trimmed to the minimum text; details live in tooltips.
   - Title "Daily limit" + help tip ("What this agent can still spend on this provider today: the
     smaller of what its limits have left. Resets at ‹time› your time."). The reset time lives only
     here — no reset line. The existing `SpendLimitButton` for the agent's own limit.
   - **Summary, one line** (`flex items-baseline gap-2`): the figure in `text-[15px] font-semibold`
     — "‹left› left today", or "Nothing left today" in danger — then, only when not ok, `·` and the
     state inline in its colour: "Close to the limit" / "Stopped until ‹time›". With no limit:
     "‹spent› today · No limit". When the owner has no all-agents limit on this Connection, a
     right-aligned small `text-accent` link "Set for all agents" (`navigateToSettings("providers")`).
     No "stops it first" sentence, no separate state line.
   - **One row per limit**, a 3-column grid (label · bar · amount, `gap-x-3 gap-y-2.5`): label
     "This agent" / "All agents" in small muted text; when both limits exist the binding one is
     `text-foreground font-semibold`. Amount "‹spent› / ‹limit›" small, muted, tabular. "Left"
     shows only in the summary. "All agents" is itself the link to Settings › Providers, with a
     tooltip "Set in Settings › Providers" — no link line.
   - **Interactive bar parts**: every part of a bar is a focusable element with a tooltip (the
     existing `Tooltip` component, as `budgets/components/pool-bar.tsx` does per segment): "This
     agent: ‹x›", "Other agents: ‹y›", and the empty track "Left: ‹z›". The shared bar is two
     segments in the state's fill split by a 2 px gap. No "This agent ‹x›, other agents ‹y›" text.
     This agent's spend is `status.spentByConnection`; all agents' is `status.ownerSpentByConnection`.
   - **Owner-wide dollars** (dollar Connections only): when the binding row of `connectionId: null`
     names `owner` or the ceiling and its state is warn/reached, one short tinted line
     (`bg-warning/10 text-warning-fg` or `bg-danger/10 text-danger`, `rounded-md px-2.5 py-1.5
     text-xs`): "Your spend limit (all agents): ‹x› left" / "Your spend limit (all agents) is reached
     until ‹time›." Same for the ceiling with its name. Never a bar.
   Split it into small components in `spend/components/` (`LimitSummary`, `LimitRowMeter`,
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
- [ ] The "All agents" bar is one colour with a 2 px gap at this agent's part; each part and the
      empty track show a tooltip on hover and keyboard focus, with figures matching
      `spentByConnection` and `ownerSpentByConnection`.
- [ ] The card has no reset line, no "stops first" sentence and no split line; the state sits
      inline in the summary.
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
