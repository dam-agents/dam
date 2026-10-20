# Spend by agent names every agent

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/5505

## Goal

An agent's Usage section lists the spend of the agent and of each sub-agent it spawned, so that a user can see which piece of work cost what.
Today the list names a sub-agent only while that sub-agent exists.
A temporary sub-agent is deleted when its work ends, so every finished sub-agent shows as "Deleted agent", with the same icon.
Settings › Usage and Home's top spenders show every deleted agent the same way.

After this change:

- Each sub-agent row names the sub-agent the way its delegation card in the chat does: by the spawn's label, else by the first line of its task.
  The full task shows on hover.
- A driver's Usage section shows its sub-agents indented under the driver's own row: the five that cost the most, then one "N more sub-agents" row with the sum of the rest.
  "Show all" lists every sub-agent, 50 at a time.
- A deleted agent keeps its last known name on Home, on Settings › Usage and in its driver's Usage section.
- Only an agent that has no recorded name still shows as "Deleted agent".
- Settings › Usage and Home stay at one row per paying agent: a sub-agent never gets a row there, because its spend is in its root driver's row.

## Approach

The pages that own this behavior are [spend-limits](../../architecture/spend-limits.md) (Ledger, Grouped read, Screens) and [invocations](../../architecture/invocations.md) (the delegation record).

**The server names the rows.**
Today the UI names an agent row from the live agents list, so it cannot name an agent that is gone.
The `spend.breakdown` read already names each provider row (`connectionName`).
It now names each agent row in the same way.
One read serves Home, Settings › Usage and the agent's Usage section, so the three surfaces cannot disagree.

**Name order.**
For each agent id in the rows, the api-server takes the first name that it finds:

1. **The sub-agent name**: the spawn's label, else the first non-empty line of the sub-agent's prompt, from its Invocation record.
   The label is the Driver's own word for the work, and [invocations](../../architecture/invocations.md) says that it names the target wherever agents are listed.
   The first line is the fallback, because a spawn may give no label.
   The delegation card and the docked delegation panel show the same name as the sub-agent's title.
   The record lives as long as the root Driver, and only the root Driver's Usage section lists sub-agents, so the name is there whenever a sub-agent row shows.
   It wins over the live name, so a running sub-agent and a finished one read the same, and the minted target name (`invocation-<label>-<hex>`) never shows: its prefix and hex are noise, and without a label it is opaque.
   Slice 01 shipped the first line alone; slice 03 puts the label first.
2. **The live name**: the agent's current name, from the api-server's replica of the Agent resources.
3. **The last known name** (slice 02): the name that the Agent resource had when it went, kept in a spend-owned table.
4. **No name**: the UI shows "Deleted agent".

**Which page shows what.**

| Page                        | Rows                                               | Sub-agent detail                                                                                                                  |
| --------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Settings › Usage, Home      | one row per paying agent (`byAgent`)               | none: a sub-agent's spend is in its root driver's row, and the "Sub-agents" session-type row gives the total                      |
| A driver's Usage section    | the driver, then its sub-agents (`byCallingAgent`) | the five that cost the most, each with its name and its task on hover, one "N more sub-agents" row, and "Show all" in pages of 50 |
| A sub-agent's Usage section | its own calls                                      | none                                                                                                                              |

The owner list grows with the agents that a user owns, not with spawns, so it needs no cap.

**The driver's card stays short (slice 03).**
One root driver can hold up to 10,000 Invocation links, and a Driver SDK script can spawn in a loop.
A flat list grows with every sub-agent that spent in the period, and naming it reads every sub-agent's Invocation record.
The api-server keeps the driver's own rows and the five sub-agents that cost the most, and sums the rest per unit.
It ranks a sub-agent by its dollars (paid plus subscription value), then by its Bobcoins, then by its calls.
It reads names and tasks only for the agent ids that it keeps.
"Show all" reads the full list through its own read, `spend.subAgents`, 50 sub-agents a page in the same order, so the first load stays small and only an expand reads more.
Each delegation card in the chat also shows its sub-agent's measured cost, and the session sidebar shows each Session's sub-agent part.

**Where a deleted agent's name comes from (slice 02).**
The `agents` table in Postgres keeps deleted agents, but it has no name, and it pseudonymizes the owner for analytics, so a name that the user wrote does not go there.
The telemetry store is optional and keeps 30 days, so the name does not come from there either.
Instead, the api-server's Agent watch sees every way that an Agent goes: a user delete, an Invocation reap, a Driver Cascade, a `kubectl delete` and the orphan sweep.
The watch's delete observation carries the last state of the resource, with its name.
The agents module emits an event with that name, and a spend saga keeps it.
Every api-server replica sees the delete, so each writes the same row; the write is an upsert.
A delete that no api-server replica sees leaves the agent with no name, and its row shows as "Deleted agent".

**No backfill.**
No release tag carries the spend ledger yet (`v0.2.23-rc2` has no spend module), so no production install has a deleted agent with ledger rows.
On dev and staging, an agent that was deleted before slice 02 keeps "Deleted agent".

**Contract (pinned).**
In `packages/api-server-api/src/modules/spend/types.ts`, the `byAgent` and `byCallingAgent` rows of `SpendBreakdown` each get one field:

```ts
agentName: string | null;
```

`agentName` is the first name in the order above, or `null`.

Slice 03 adds two more.
Each `byCallingAgent` row gets the task, and `SpendBreakdown` gets the sum of the sub-agents that the read leaves out:

```ts
agentTask: string | null; // on byCallingAgent rows
otherSubAgents: {
  count: number;
  amounts: (SpendAmount & { calls: number })[];
};
```

`agentTask` is the sub-agent's full prompt, or `null` for an agent that is not a sub-agent.
`otherSubAgents` is `{ count: 0, amounts: [] }` outside the driver's scope.

Slice 03 also adds one read, for "Show all":

```ts
subAgents(input: {
  agentId: string;
  from: string;
  to: string;
  offset: number;
  limit: number; // at most 50
}): Promise<{
  count: number;
  rows: SpendBreakdown["byCallingAgent"];
}>;
```

`count` is the number of the driver's sub-agents that spent in the period.
`rows` are the entries of the sub-agents from `offset` to `offset + limit - 1` in the cap's order, named the same way.
For an agent that is not a driver, the read returns `{ count: 0, rows: [] }`.
The id stays the only key; the name is for display only.
The UI shows `agentName ?? "Deleted agent"` and no longer reads a name from the live agents list.
It still reads the live agents list for the avatar image and to grey out the avatar of an agent that is gone.

## Sub-issues

| #   | Title                                       | Scope                                                                                                                                                                                         | Depends on |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 01  | ✅ Sub-agent rows name their task           | `agentName` in the contract, filled from Invocation titles and live names; shared title helper; the three UI surfaces use the server name; Bot icon on sub-agent rows                         | —          |
| 02  | Deleted agents keep their last known name   | Name table and migration; Agent watch event; spend saga; third name source; activity-events page; Ledger and Screens text                                                                     | 01         |
| 03  | The driver's card names and caps sub-agents | Label-first names in the shared helper, the delegation card and the spend read; task on hover; sub-agents indented under the driver; top five, one "N more" row and "Show all" in pages of 50 | 01         |

## Conventions & glossary

- **Agent row**: one row of a "Spend by agent" list, or one of Home's top spenders.
- **Sub-agent name**: an Invocation's label, trimmed, else the first non-empty line of its prompt, trimmed.
  One shared helper in `api-server-api` computes it for the delegation card, the docked panel and the spend read, so they cannot drift.
- **Task**: an Invocation's full prompt; a sub-agent row shows it on hover, as the delegation card's title does.
- **Last known name**: the name of an Agent resource at the moment the api-server's watch saw it go.
- **Visuals**: no new visual.
  The issue names no Figma frame.
  A sub-agent row reuses the bare accent Bot icon at 14 px from the delegation block's header (`delegation-shell.tsx`), in a 16 px slot, the avatar's size, so that every label starts at the same place.
  Sub-agent rows and the "N more sub-agents" row are indented by one icon slot and the row's gap, so that each Bot sits under the driver's name.
  The "N more sub-agents" row has no icon.
  "Show all N sub-agents", "Show 50 more" and "Show less" are text buttons under the list, like the tool chip's "Show all N lines".
  A deleted agent keeps the greyed avatar (`mood="disabled"`) that it has today, now with its name.
  There is no "(deleted)" text.
- **Names in the plan** (helpers, ports, the table, the event) are illustrative, except the contract field `agentName`.
  Fit them to the surrounding code.
- **Skills**: apply `/typescript-engineering` to server-side TypeScript and `/react-ui-engineering` to `packages/ui`.
- **Tests**: add no new tests.
  Verify with the existing suite (`mise run test`, `mise run check`) and the manual smoke tests.
- **Comments**: follow [`docs/guidelines/comment-guidelines.md`](../../guidelines/comment-guidelines.md); run `mise run check:comment-types`.
- **Docs**: edit the architecture pages in the slice that changes the behavior, bump `Last verified:`, and run `mise run fix:markdown`.
  `persistence.md` is 7 letters under its size cap, so do not edit it.
  Its "kept on purpose" list already names the spend ledger, and the name table is part of the ledger.
- **Brand**: no brand string in code or copy.

## Whole-feature smoke test

On the local dev cluster ([`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md)), with both slices built (`mise run cluster:build -- api-server ui`), in the dev app at `http://localhost:4444`:

1. In a driver agent's chat, ask for seven temporary sub-agents, each with a different one-line task; give six of them a label and one none.
2. Wait until all seven finish.
3. Open the driver's Usage section.
   "Spend by agent" lists "<driver name> (this agent)" first, then five indented rows and one "2 more sub-agents" row.
   Each named row shows the spawn's label, or the first line of its task when it has no label, as the delegation cards in the chat do, with the accent Bot icon.
   Hovering a row shows its full task.
   "Show all 7 sub-agents" lists all seven, and "Show less" goes back to five.
4. Create an agent, send it one message so that it spends, then delete it.
   Settings › Usage "Spend by agent" shows its name beside a greyed avatar.
   Home's top spenders show its name too, when it is among the top three.
5. Delete the driver from step 1.
   Settings › Usage shows the driver's name beside a greyed avatar.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/5505.
