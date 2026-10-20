# 01 — Sub-agent rows name their task

**Part of:** Spend by agent names every agent — see [README](./README.md)

## Context

This slice adds `agentName` to the agent rows of `spend.breakdown` and fills it from the first two sources of the name order: the Invocation title and the live name.
The three UI surfaces then show the server's name instead of a name from the live agents list.
After this slice, a driver's Usage section names each finished sub-agent by the first line of its task, with the accent Bot icon.
A deleted agent that is not a sub-agent still shows as "Deleted agent" until slice 02.

## Implementation plan

Apply `/typescript-engineering` to steps 1–6 and `/react-ui-engineering` to steps 7–9.

1. **Shared title helper.**
   Move `firstLine` from `packages/ui/src/modules/invocations/lib/delegation-state.ts` into a new browser-safe file in the contract package, for example `packages/api-server-api/src/modules/invocations/delegation-title.ts` with `delegationTitle(prompt: string): string`.
   Keep its behavior: the first line that is not blank, trimmed, or `""`.
   Export it from `packages/api-server-api/src/index.ts`, next to the other invocations exports (the spend `turn-windows.ts` export is the precedent for a shared helper).
   Make `packages/ui/src/modules/invocations/components/delegation-card.tsx` and `docked-delegation-panel.tsx` import it, and delete `firstLine` from `delegation-state.ts`.

2. **Contract field.**
   In `packages/api-server-api/src/modules/spend/types.ts`, add `agentName: string | null` to the `byAgent` and `byCallingAgent` row types of `SpendBreakdown` (see the pinned contract in the README).

3. **Invocation titles adapter.**
   In `packages/api-server/src/modules/invocations/infrastructure/`, add a reader that takes an owner and a list of agent ids and returns a map from id to Invocation title.
   It selects `id` and `prompt` from `invocations` where `owner` is the owner and `id` is in the list, maps each prompt through `delegationTitle`, and leaves out an empty title.
   The Invocation id is the target agent's id (`invocations-service.ts` creates both from one `targetId`), so the ledger's calling-agent ids match directly.
   Read only the ids that the breakdown rows name, never the whole tree of the root: a root can have up to 10,000 links, each with a full prompt.
   Expose a factory from `packages/api-server/src/modules/invocations/compose.ts`, as `createSpawnSessionsAdapter` does.

4. **Spend ports.**
   In `packages/api-server/src/modules/spend/services/spend-service.ts`, next to `ConnectionNames`, declare two ports: one for the live names of an owner's agents and one for the Invocation titles of a list of agent ids.
   Add both as required deps of `createSpendService` and `composeSpendSystem` (`packages/api-server/src/modules/spend/compose.ts`).

5. **Fold the names.**
   In `packages/api-server/src/modules/spend/domain/breakdown.ts`, give `foldBreakdown` an `agentNames: ReadonlyMap<string, string>` input, and set `agentName: input.agentNames.get(id) ?? null` on each `byAgent` and `byCallingAgent` entry, as `byConnection` sets `connectionName`.
   Put the name order in one small pure domain function that merges the source maps, first source wins, so slice 02 adds its source in one place.
   In `breakdown()`, read the live names in parallel with the rows and the connection names.
   Then read the Invocation titles for the distinct ids in the rows (each row's payer and calling agent), merge titles before live names, and pass the result to the fold.

6. **Wiring.**
   In `packages/api-server/src/bootstrap.ts` (the `composeSpendSystem` call), adapt `agentsRepo.list(ownerSub)` (each `InfraAgent` has `id` and `name`) to the live-names port, and pass the factory from step 3 to the titles port.

7. **Row labels.**
   In `packages/ui/src/modules/spend/lib/breakdown-sources.ts`, make `agentSources` label each agent from the rows' `agentName`, not from a `nameOf` callback over the live list.
   A row group has one id and so one name; take it from the first row of the group.
   Default the label to `agentName ?? DELETED_AGENT_NAME`, and let the caller wrap it, so the driver's own row can still read "<name> (this agent)".
   The id-to-name lookup is needed by `agentSources` and by Home's top spenders, so write it once in the spend `lib/`.

8. **Breakdown cards.**
   In `packages/ui/src/modules/spend/components/measured-breakdown-cards.tsx`:
   - the owner card ("Spend by agent" on Settings › Usage) uses the server names;
   - the driver card puts the driver's row first as now, labelled `thisAgent(agentName ?? agentId)`;
   - in the driver card, every row other than the driver's own is a sub-agent by construction (its calling agent is not its payer), so its icon is the delegation block's bare Bot icon: `<Bot size={14} className="shrink-0 text-accent" aria-hidden />` from `@carbon/icons-react`, as in `packages/ui/src/modules/invocations/components/delegation-shell.tsx`;
   - every other row keeps `AgentAvatar` at size 16, with the server name, the avatar image from the live agents list, and `mood="disabled"` when the live list has no such agent.

9. **Home's top spenders.**
   In `packages/ui/src/modules/spend/components/top-spenders.tsx`, carry each spender's `agentName` from the rows, and show `agentName ?? DELETED_AGENT_NAME`.
   Keep the avatar image and the greyed mood from the live agents list.
   Names are server state from the breakdown query: read them from the query data, and do not copy them into component state.

10. **Docs.**
    - `docs/architecture/spend-limits.md`, Grouped read: say that the api-server names each agent row, a sub-agent by the first line of its task from its Invocation record, any other agent by its live name.
    - `docs/architecture/spend-limits.md`, Screens (the "A driver's Usage section lists the driver and each sub-agent…" sentence): say that each sub-agent row shows the first line of its task, as its delegation card does.
    - `docs/architecture/invocations.md`, The delegation record: one sentence that the record also names each sub-agent's row in its root Driver's spend by agent, which is why it must outlive the target.
    - Bump `Last verified:` on both pages and run `mise run fix:markdown`.

## Acceptance criteria

- [x] `spend.breakdown` for a driver returns `agentName` on every `byCallingAgent` row: the first line of the prompt for each sub-agent, the live name for the driver.
- [x] `spend.breakdown` with no `agentId` returns the live name on each `byAgent` row of a live agent, and `null` for a deleted one.
- [x] A running sub-agent's row shows its task line, not its minted `invocation-…` name.
- [x] The delegation card, the docked delegation panel and the spend read import one title helper from `api-server-api`; `firstLine` no longer exists in `packages/ui`.
- [x] No spend component reads an agent's name from `useAgentsList()`; they read it only for the avatar and the mood.
- [x] In a driver's Usage section, each sub-agent row has the 14 px accent Bot icon, and the driver's row keeps its avatar.
- [x] Settings › Usage, Home's top spenders and the driver's Usage section show the same name for the same agent.
- [x] `mise run check` and `mise run test` pass, and `mise run check:comment-types` passes.

## Smoke test

1. Run `mise run //packages/api-server-api:check`, `mise run //packages/api-server:check`, `mise run //packages/ui:check`, then `mise run //packages/api-server:test` and `mise run //packages/ui:test`.
2. Build and roll out: `mise run cluster:build -- api-server ui`.
3. In the dev app (`http://localhost:4444`), ask a driver agent for three temporary sub-agents with three different one-line tasks, and wait until all three finish.
4. Open the driver's Usage section.
   "Spend by agent" shows "<driver name> (this agent)" first, then three rows that each carry the first line of one task and the accent Bot icon.
   The titles match the three delegation cards in the chat.
5. In the browser's network panel, open the `spend.breakdown` response for that page: each `byCallingAgent` row has `agentName` set.
6. Open Settings › Usage and Home: the live agents keep their names and avatars, as before.

Then print a short manual guide so the user can repeat steps 3–6 by hand.
