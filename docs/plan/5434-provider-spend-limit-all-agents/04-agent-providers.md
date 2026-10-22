# 04 — The limit ladder in all four places

**Depends on:** 02-binding, 03-meter
**Part of:** Provider spend limit for all agents — see [README](./README.md)

## Context

The operator replaced the agent card of v11 with one pattern for every place a limit shows
([`ladder.html`](./ladder.html), approved v2).
Each place shows the limit it owns, settable there;
the other limits that count the same calls show muted, each with its own icon, in a list that the
place's line opens and closes.
The limit dialog says which limit stops first before saving.

| Place                | Owns                       | Also counted by                                             |
| -------------------- | -------------------------- | ----------------------------------------------------------- |
| Settings › Usage     | total daily limit          | ceiling                                                     |
| Settings › Providers | one provider, all agents   | total, ceiling (dollar providers)                           |
| Agent › Usage        | agent limit                | each provider's agent and all-agents limits, total, ceiling |
| Agent › Providers    | this agent on one provider | all agents on it; agent limit, total, ceiling (dollar)      |

## Implementation plan

Apply **/react-ui-engineering**.

1. **Model** — `spend/lib/limit-levels.ts`: pure builders from `SpendStatus` to `{ current, others }`
   per place (`totalLevels`, `allAgentsConnectionLevels`, `agentConnectionLevels`, `agentLevels`);
   each `Level` carries kind, Connection, unit, amounts, state, this agent's part of a shared limit
   and `stopsFirst` (least left, when it is not the current one).
   `lib/level-labels.ts` names each
   level and the place that sets it.
2. **Pieces** — `LevelIcon` (provider tile; provider tile with a people badge for all agents; the
   agent's avatar for the agent limit; ∑ for the total; a lock for the ceiling), `LevelList`
   (muted rows, thin shared bar, %, "‹spent› of ‹limit› today", "Set in ‹place›", "stops first"),
   `AlsoCountedBy` (the Usage cards' toggle line with small icon chips while closed) and
   `LimitLine` (the provider lists' compact line: bar, %, Change, chevron; the whole line toggles;
   "‹name› stops first" under the bar while closed).
3. **Places** — Settings › Usage: `AlsoCountedBy` under the total; the provider summary rows get
   their icon.
   Settings › Providers and Agent › Providers: `LimitLine` (no label: the page says
   whose limit it is; the Change tooltip says it too).
   Agent › Usage: `AlsoCountedBy` grouped
   "On one provider" / "Every provider"; the old "stops this agent first" sentence and
   `nearer-limit.ts` go.
4. **Dialog line** — `components/spend-limit-dialog.tsx`: optional `compare`
   `{ spentMicros, other: { name, leftMicros } | null }`; under the field "‹spent› spent today."
   and, while typing, one `aria-live` line: already reached / "‹other› has ‹x› left today, so it
   stops this agent first."
   / "This limit stops this agent first: ‹x› left today."
   Never blocks
   Save.
   The agent's provider line passes its all-agents limit.
5. **Docs** — `docs/architecture/spend-limits.md` **Screens**.
   `/doc-drift`.

## Acceptance criteria

- [ ] All four places show their own limit first, settable there, and the others muted with
  their icons; the ceiling shows only when the operator set one.
- [ ] Settings › Providers and Agent › Providers: one line per provider; the whole line opens
  and closes the list; no chevron when nothing else counts the calls.
- [ ] Agent › Usage lists the provider limits by provider, then the total and the ceiling.
- [ ] "stops first" marks the limit with the least left when it is not the place's own, both
  closed (chip or line under the bar) and open (badge).
- [ ] The dialog's line updates while typing and never blocks Save.
- [ ] `nearer-limit.ts` is gone; `mise run check` and `mise run test` pass.

## Smoke test

`mise run check` and `mise run test`.

Then on a local cluster: set agent A's Anthropic limit to $5 and the all-agents Anthropic limit to
$0.05; spend a little on A and on B.
A's Providers page shows A's own "‹spent› of $5.00 today", the
"All agents" bar near or at 100 % with A's part solid and B's lighter; raise the all-agents limit
to $20 in Settings › Providers and the All agents bar drops back.
Open "Change" on A's
limit and type 0.01, 2 and 50: the line under the field changes accordingly.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
