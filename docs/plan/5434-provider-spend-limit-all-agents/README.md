# Provider spend limit for all agents

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/5434

## Goal

A user sets one daily limit for a connected provider, and it holds for all their agents together,
including agents they create later, sub-agents, and agents deleted that day.

The main case is **dollar providers with separate budgets**: a personal Anthropic key next to the
company IBM LiteLLM.
Today "Your spend limit (all agents)" caps only the sum of all paid providers,
and a per-agent provider limit caps one agent at a time, so nothing caps one dollar provider across
agents.
The Claude subscription and Bob are the second case: today only per-agent provider limits
stop them, so a new agent starts unlimited and one busy agent can use up the shared plan.

Every place that shows a limit tells the user which limit stops the calls first: the one with the
least left today.

## Approach

Read [`docs/architecture/spend-limits.md`](../../architecture/spend-limits.md) first; this feature
extends its **Limits**, **Unattended work**, **Continue** and **Screens** sections.

**A fourth limit scope.** `LimitScope` (`packages/api-server/src/modules/spend/domain/limits.ts`)
has `agent`, `owner` and `connection` (one agent on one Connection).
Add
`{ kind: "owner-connection", connectionId }`: all agents of the owner on one Connection, in that
Connection's unit.
It applies to every Connection that takes a per-agent Connection limit today
(`connectionLimitRule(templateId).limitable`), dollar Connections included.

- **Storage:** `spend_limits` already fits — `scope = 'owner-connection'`, `agent_id` null,
  `connection_id` set.
  The unique key is `nulls not distinct`, so one limit per owner and
  Connection.
  No migration.
- **Counter:** a new `DayCounter` `{ scope: "owner-connection", day, ownerSub, connectionId }`,
  key `spend:<day>:ownerconn:<ownerSub>:<connectionId>`, added by `dayCountersOf` and rebuilt by
  `SpendLedger.total` from `spend_daily` on `(day, owner_sub, connection_id)`.
  The rollup keeps
  the rows of sub-agents (they count for their payer) and of deleted agents, so both count.
- **Gate:** `limitsOnCall` matches it when `call.ownerSub` and `call.connectionId` match.
  `SpendLimits.applying` returns it with the owner's other limits.
  Holds, the refusal and the
  continue question then follow with no new code paths: the check already refuses on any reached
  limit and asks one question per reached limit.
- **Ownership:** only the owner of the Connection sets it; `setLimit` checks the Connection
  belongs to the caller and takes a limit.
  The limit is deleted when the Connection is removed
  (`EventType.ConnectionRemoved`).

**"Stops first" moves to the server.** Today the UI works out "your limit for all agents / the
ceiling stops this agent first" in the browser, for dollars only
(`packages/ui/src/modules/spend/lib/nearer-limit.ts`).
The issue wants the same answer in the
CLI and the agent's tool, across units.
`spend.status` computes it once; every surface reads it.

### tRPC contract (pinned; 01 and 02 implement it, 03 and 04 read it)

```ts
// packages/api-server-api/src/modules/spend/schemas.ts
spendLimitScopeSchema = z.discriminatedUnion("kind", [
  { kind: "agent", agentId },
  { kind: "owner" },
  { kind: "connection", agentId, connectionId },
  { kind: "owner-connection", connectionId },            // NEW (01)
]);

// packages/api-server-api/src/modules/spend/types.ts
interface SpendStatus {
  day; resetsAt; limits; ceiling; spent; spentByConnection;  // unchanged
  ownerSpentByConnection: SpendConnectionTotal[];         // NEW (01): today's spend of all
                                                          //   the owner's agents per Connection
  binding: SpendBinding[];                                // NEW (02): only with input.agentId
}

// NEW (02): for one agent, per unit and Connection it can spend on, what is left and which
// limit leaves the least. `limitId` null means the ceiling.
interface SpendBinding {
  connectionId: string | null;   // null: the agent's dollar spend across Connections
  unit: SpendUnit;
  leftMicros: number;
  stopsFirst: { kind: SpendLimitScope["kind"] | "ceiling"; limitId: string | null };
  others: { kind: SpendLimitScope["kind"] | "ceiling"; leftMicros: number }[];
}
```

`spend.setLimit` keeps its input; a `{ kind: "owner-connection" }` scope is new to it.

## Sub-issues

| #     | Title                                                          | Scope                                                                                                                                                         | Depends on |
| ----- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 01 ✅ | [All-agents provider limit in the gate](./01-gate.md)          | New scope, counter, gate check, `setLimit`, `dam spend limit --me --connection`, cleanup on Connection removal, Home question text, architecture page         | —          |
| 02    | [Which limit stops first, from the server](./02-binding.md)    | `binding` in `spend.status`; the agent's tool and `dam spend status` show it                                                                                  | 01         |
| 03    | [Limit meters: black, thin, one family](./03-meter.md)         | `DailyLimitMeter` and Home's memory bars restyled; Settings › Providers block; Settings › Usage summary                                                       | 02         |
| 04 ✅ | [The limit ladder in all four places](./04-agent-providers.md) | One pattern on Settings › Usage, Settings › Providers, Agent › Usage and Agent › Providers: own limit first, others muted with icons, expandable; dialog line | 02, 03     |

```mermaid
graph LR
  01 --> 02 --> 03 --> 04
  02 --> 04
```

## Conventions & glossary

- **All-agents provider limit** — the new limit: one Connection, all agents of its owner.
  Named
  on screens "Your ‹Connection name› spend limit (all agents)"; titled "Daily limit for all agents"
  inside a provider row.
  Scope kind `owner-connection`.
- **Agent provider limit** — the existing per-agent Connection limit (`connection` scope).
- **Your spend limit (all agents)** — the existing `owner` dollar limit; on the agent's Providers
  section it is the **Total** row ("total daily limit").
  **Spend ceiling** — the operator's hard
  dollar maximum; it has no bar on a provider.
- **Stops first / binding** — the limit with the least left today among those counting a call.
- **Left** — `max(0, effective − spent)`, effective = amount × (1 + extensions).
- Apply **/typescript-engineering** for server-side TS (`api-server`, `api-server-api`, `cli`) and
  **/react-ui-engineering** for `packages/ui`.
  Copy follows the existing `spend/lib/copy.ts` voice:
  plain sentences, the reset time in the reader's own time on screens, UTC for agents.

### Approved UI design

[`mockup.html`](./mockup.html) set the bar's look (03); [`ladder.html`](./ladder.html), approved
after it, sets how limits show on every page (04).
Open them in a browser; purple boxes are notes.

- **Meters are black** on a light tint of the same colour; orange at 80 %, red when reached; the
  share used beside the bar; "‹spent› of ‹limit› today" with it.
  12 px (`h-3`); the muted rows of
  the ladder and the Usage provider summary 4–6 px.
  Home's resource bars take the same fill.
- **A shared limit's bar**: this agent's part solid, a 2 px gap, the other agents' part lighter;
  each part and the empty track name their amount on hover or focus.
- **The ladder** (04): each place shows its own limit first and the others muted, each with its
  icon, in an expandable list; a limit set by the operator (the ceiling) shows only when set.

## Progress notes

- **01** is committed.
  Verified on the local cluster: setting and clearing the limit with
  `dam spend limit --me --connection`, and `dam spend status` listing it in each Connection's unit.
  Not yet verified live: a model call counted against the limit and refused at it — the operator
  checks that in the whole-feature smoke test (the cluster's VM runner could not be rebuilt here).
- **02** is committed.
  `SpendBinding` also carries `connectionName`, so the agent tool and the CLI
  name the provider without a second lookup.
  Verified with `dam spend status <agent>` on the
  cluster: a subscription row names only its own limits; a dollar row compares all of them.
- **03** is committed.
  Settings › Usage (summary) and Settings › Providers (limit block) checked in
  the browser on the cluster.
  Home's memory/CPU bars were not seen: they show only while an agent
  runs, which this cluster could not do.
  `ProviderRow` takes a `footer`, rendered below a header
  button, so the limit button is never nested in the row's button.
- **04** is committed: the ladder (`ladder.html`, approved v2) on all four places, replacing the
  three-row agent card of v11.
  Settings › Usage and Settings › Providers now use it too, so 03's
  Settings screens changed again here.
  Checked in the browser on the cluster, and a real turn on
  the subscription counted in this agent's and all agents' limits.
  The cluster's VM runner works
  again after moving its folders onto an idmap-capable disk (sandbox only).

## Whole-feature smoke test

On a local cluster (`mise run cluster:install`), signed in as one user:

1. Connect an Anthropic key and IBM LiteLLM; create agents A and B on Anthropic.
2. In Settings › Providers, set Anthropic's daily limit for all agents to $0.05.
   Settings › Usage
   shows a small Anthropic bar under "Daily spend limit".
3. Run a turn on A, then on B.
   Once the shared spend passes $0.05, the next call of either agent is
   refused with "Spend limit reached"; Home asks one question naming "Your Anthropic spend limit
   (all agents)" and saying Continue lets all agents go on.
   LiteLLM calls still go through.
4. On A's Providers page: the "All agents" bar is red at 100 %, A's part solid and the other
   agents' part lighter; the summary still shows A's own spend and limit.
5. Set A's own Anthropic limit to $0.02 and continue the shared one: A's summary turns to "Stopped
   until ‹time›"; `dam spend status A` and A's `describe_spend_limits` name A's own limit as stopping
   first.
6. A scheduled fire on B while the shared limit is reached is held; a sub-agent spawned by A
   counts toward the shared limit.
7. Delete agent B: today's spend still counts.
   Disconnect Anthropic: the limit is gone.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/5434.
