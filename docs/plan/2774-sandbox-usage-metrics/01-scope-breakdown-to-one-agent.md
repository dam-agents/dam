# 01 — Narrow the spend breakdown to one agent, add model time

**Part of:** Sandbox-level usage metrics — see [README](./README.md)

## Context

`metrics.spendBreakdown` is deliberately all-agents: the service hands its `ownedScope` helper an
`undefined` agent id, so every read spans the caller's whole agent set. The sandbox Usage section
needs the same three rollups for one agent, plus a per-model duration the rollup never asked for.
Both changes are additive — the global Usage view's behaviour is untouched.

Apply the **`/typescript-engineering`** skill.

## Implementation plan

1. **`packages/api-server-api/src/modules/metrics/schemas.ts`** — add `agentId` to
   `metricsSpendBreakdownInputSchema`:

   ```ts
   export const metricsSpendBreakdownInputSchema = metricsSpendInputSchema.extend({
     agentId: z.string().min(1).optional(),
     timeZone: z.string().min(1).refine(isValidTimeZone, { message: "invalid IANA timeZone" }),
   });
   ```

   Extend the block comment above it to say `agentId` narrows to one owned agent and that omitting
   it means every agent the caller owns. The comment on `metricsSpendInputSchema` says the range is
   shared "across all of the caller's agents" — that clause is now wrong for `spendBreakdown` and
   belongs on neither schema; drop it and leave the comment about instants-not-calendar-fields.

2. **`packages/api-server-api/src/modules/metrics/types.ts`** — add `durationMs: number` to
   `TokenSpendByModel`. Its doc comment must state that the figure is summed per-call latency, so
   concurrent calls overlap in it and it is not elapsed wall-clock. Also update the
   `MetricsService.spendBreakdown` doc, which currently promises "across all of the caller's
   agents", to cover the narrowed case.

3. **`packages/api-server/src/modules/metrics/services/metrics-service.ts`** — in
   `spendBreakdown`, pass the input through:

   ```ts
   const ids = await ownedScope(deps.listOwnedAgentIds, query.agentId);
   ```

   `ownedScope` already returns `[]` for an unowned agent, and the existing early return turns that
   into empty rollups. No other change: the "resolve ownership once, then fan the three rollups
   out" comment stays true.

4. **`packages/api-server-api/src/modules/metrics/router.ts`** — layer the API-key binding check on
   the narrowed read, mirroring `overview` directly above it:

   ```ts
   spendBreakdown: readAgentProcedure
     .input(metricsSpendBreakdownInputSchema)
     .query(({ ctx, input }) => {
       if (input.agentId) checkAgentBinding(ctx, input.agentId);
       return ctx.metrics.spendBreakdown(input);
     }),
   ```

   The file's top comment already explains this pattern for the whole router; extend its wording to
   cover both procedures rather than adding a second copy of the explanation.

5. **`packages/api-server/src/modules/metrics/infrastructure/clickhouse-reader.ts`** — in
   `tokenSpendByModel`, add `sum(${IN("'duration_ms'")}) AS durationMs` to the SELECT and
   `durationMs: n(x.durationMs)` to the row mapping. `IN()` and `n()` are the existing helpers;
   `runtimeBySession` already reads `duration_ms` the same way, so no new attribute coupling.

6. **`docs/architecture/metrics.md`** — the architecture page is the source of truth and currently
   contradicts this slice. Update, in the **Contract** section's *Spend breakdown* bullet:
   - it reads "across *all* of the caller's agents" — now optionally one owned agent, for the
     sandbox-scoped Usage section;
   - the sentence explaining why it is a single procedure (ownership resolves once, one client
     loading state) stays as-is — still true, and still the reason the per-agent rollup is computed
     even when it collapses to one row;
   - in the **Telemetry reader** section, add per-call **duration** to the list of counters the
     reader sums, alongside the token and cost counters.

   Bump `Last verified:` to today's date. Do **not** reference an ADR from the page.

## Acceptance criteria

- [ ] `mise run check` passes (typecheck + lint across the workspace).
- [ ] `mise run test` passes — in particular the four existing `spendBreakdown` cases in
      `packages/api-server/src/__tests__/unit/metrics-service.test.ts`, unchanged.
- [ ] `spendBreakdown` called **without** `agentId` still resolves the caller's full owned set —
      the global Usage view's behaviour is byte-for-byte unchanged.
- [ ] `spendBreakdown` called with an `agentId` the caller does not own returns empty rollups
      rather than an error, matching `overview`'s ownership guarantee.
- [ ] `TokenSpendByModel.durationMs` is populated from `sum(duration_ms)` and documented as summed
      latency, not wall-clock.
- [ ] `docs/architecture/metrics.md` no longer claims the breakdown is always all-agents, and lists
      duration among the summed counters.

## Smoke test

1. `mise run check && mise run test` — both green. The existing metrics-service unit tests cover
   the ownership-scoping paths this slice touches; they must pass without modification.
2. Confirm no other caller broke on the additive field:
   `grep -rn "TokenSpendByModel" packages --include='*.ts' --include='*.tsx' | grep -v node_modules`
   — expect the reader, the contract, `ModelSpendTable` and `MetricsPanel`, none of which construct
   the type from a literal.
3. Against a cluster with observability enabled, call the procedure both ways and compare — the
   narrowed total must be ≤ the unnarrowed one, and `byAgent` must collapse to a single row:

   ```
   mise run cluster:port-forward   # if not already reachable
   # then, from the UI devtools console while signed in:
   #   await window.__trpc.metrics.spendBreakdown.query({ from, to, timeZone })
   #   await window.__trpc.metrics.spendBreakdown.query({ from, to, timeZone, agentId })
   ```

   If no such devtools handle is exposed, defer this check to slice 03's smoke test, where the UI
   exercises the narrowed read directly.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
