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
   - Title "Daily limit" + help tip ("What this agent can spend on this provider today, and the
     limits that count it. Resets at ‹time› your time."). The reset time lives only here — no reset
     line. The existing `SpendLimitButton` for the agent's own limit.
   - **Summary, one line** (`flex items-baseline gap-2`): this agent's own spend and limit in
     `text-[15px] font-semibold` — "‹spent› of ‹limit› today" — or, without an agent limit,
     "‹spent› today · No limit for this agent". Then, **only from this agent's own limit's state**,
     `·` and inline "Close to the limit" (warning) / "Stopped until ‹time›" (danger, the figure
     turns danger too). The all-agents and total limits never set this state; their bars do.
     When the owner has no all-agents limit on this Connection, a right-aligned small
     `text-accent` link "Set for all agents" (`navigateToSettings("providers")`).
   - **Up to three rows**, a 3-column grid (label `w-[76px]` · bar · percentage `w-10 text-right`,
     `gap-x-2.5 gap-y-2.5`):
     - **This agent** — the agent's `connection` limit; bar = this agent's spend on the Connection.
     - **All agents** — the owner's `owner-connection` limit; bar = this agent's part, then the
       other agents' part. Label links to Settings › Providers (tooltip "Set in Settings ›
       Providers").
     - **Total** — the owner's `owner` dollar limit ("total daily limit"), **dollar Connections
       only**; bar = this agent's paid spend on all providers, then the other agents'. Label links
       to Settings › Usage (tooltip "Total daily limit: all your agents, every paid provider").
       The ceiling has no row.
     Each row: label small muted; the bar 12 px (`h-3`, the 03 track); the percentage small,
     tabular, in the row's state colour (muted when ok). Under the bar, in `text-[11px]
     text-muted-foreground/80 tabular-nums`: "‹spent› of ‹limit›" (Total: "… on all paid
     providers").
   - **Shared bars** (All agents, Total): this agent's part in the state's fill, a 2 px gap
     (`gap-0.5` on the flex track), then the other agents' part in a **lighter shade of the same
     fill** (`LIMIT_STATE_SHARE`: ok `bg-foreground/45`, warn `bg-warning/45`, reached
     `bg-danger/45`).
   - **Interactive bar parts**: every part, and the empty track, is focusable with a tooltip (the
     existing `Tooltip`, as `budgets/components/pool-bar.tsx` does per segment): "This agent: ‹x›",
     "Other agents: ‹y›", "Left: ‹z›". Data: this agent on the Connection —
     `status.spentByConnection`; all agents on it — `status.ownerSpentByConnection`; this agent's
     paid spend — `status.spent` (usd); the owner's — the `owner` limit's `spentMicros`.
   Split it into small components in `spend/components/` (`LimitSummary`, `LimitRow`,
   `SharedLimitBar`) per **/react-ui-engineering**; keep copy in `lib/copy.ts`.
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

- [ ] Each of the six mockup states renders as in the mockup, with and without a total daily limit:
      both provider limits (either one binding), only all-agents, only the agent's, all-agents
      reached, no limits.
- [ ] The summary shows this agent's own spend and limit; its state follows only that limit.
- [ ] Every row shows its percentage to the right and "‹spent› of ‹limit›" small under the bar;
      the Total row shows only on dollar Connections.
- [ ] On shared bars this agent's part is solid and the other agents' part a lighter shade after a
      2 px gap; each part and the empty track show a tooltip on hover and keyboard focus.
- [ ] The dialog's line updates while typing and never blocks Save.
- [ ] The agent's Usage card names the same stopping limit as `dam spend status <agent>`.
- [ ] `nearer-limit.ts` is gone; `mise run check` and `mise run test` pass.

## Smoke test

`mise run check` and `mise run test`.

Then on a local cluster: set agent A's Anthropic limit to $5 and the all-agents Anthropic limit to
$0.05; spend a little on A and on B. A's Providers page shows A's own "‹spent› of $5.00 today", the
"All agents" bar near or at 100 % with A's part solid and B's lighter; raise the all-agents limit
to $20 in Settings › Providers and the All agents bar drops back. Open "Change" on A's
limit and type 0.01, 2 and 50: the line under the field changes accordingly.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
