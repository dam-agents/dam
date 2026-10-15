# 03 — Token allowance in the gate

**Depends on:** 02-ensure-and-default, and PR [#4731](https://github.com/dam-agents/dam/pull/4731) merged into `main` (rebase this branch first)
**Part of:** Built-in model provider — see [README](./README.md)

## Context

This slice bounds the platform's cost: a daily token allowance per user across all built-in Connections, enforced in the gate #4731 adds, the same way #4731 enforces the Spend Ceiling.
It also makes the allowance readable by the API, the CLI and the agent.
Read `docs/architecture/spend-limits.md` (from #4731) before starting; every mechanism named here is described there.

## Implementation plan

Apply `/typescript-engineering`.
All paths are in the `spend` module that #4731 adds (`packages/api-server/src/modules/spend/`, `packages/api-server-api/src/modules/spend/`).

1. **Unit.** Add `"token"` to `spendUnitSchema`.
   The unit of a call becomes a property of the Connection, not only of its provider template: a built-in Connection's unit is `token`, any other keeps `spendUnitOfProvider(templateId)`.
   The meter already writes the Connection id on each record and the api-server already looks the Connection up at ingest; read `builtIn` there.
   `connectionLimitRule` returns not limitable for a built-in Connection, with a reason text "Calls on this connection count in the included allowance."
2. **Cost in tokens.** At ingest, a `token`-unit call's cost is the sum of its uncached input, cache read, cache write and output tokens (PROPOSED D1), stored in the same micro-unit column as an integer token count times 1 (document that `token` is not micro-scaled), so the ledger and the Redis counters need no new shape.
   The owner-and-unit day counter `spend:<day>:owner:<sub>:token` is then exactly the allowance counter, and its rebuild from `spend_daily` works unchanged.
3. **Check.** Beside the ceiling in `domain/limits.ts` and `services/spend-check.ts`:
   - a `token` call is checked against `config.builtInProviders.dailyTokenAllowance`; reached refuses with a new block reason `allowance`;
   - hard, like the ceiling: no `spend_limit` approval, no extension;
   - `holdFor` returns the `allowance` block too, so schedules, spawns and channel turns are held with no further change (#4731's hold calls `holdFor` with the work's Connection).
   - A `token` call is never counted in the agent limit, own limit or ceiling.
4. **Refusal text** (`domain/refusal.ts`), PROPOSED D3, same digit rules as the soft text:
   `Included model allowance used up for today. Connect your own model provider in <brand> to keep working.`
   Without a usable brand: `… Connect your own model provider to keep working.`
   It must contain "quota exceeded"-style wording Pi stops on; confirm Pi stops at once on this text with the existing refusal check of #4731 (its harness refusal tests), and if Pi retries, prefix "Quota exceeded:".
5. **Contract.** `spend.status` gains `allowance` as pinned in the README; compute it from the owner `token` counter and config; `null` when no built-in provider is enabled.
6. **Agent read tool.** The read-only spend tool of #4731 (platform MCP) includes the allowance, so an agent can tell its owner how much is left — the Slack-only user's only view (#5058).
7. **CLI.** `dam spend status` prints the allowance line (`packages/cli/src/modules/spend/`).
8. **Channel notice.** #4731's channel hold tells a waiting person why no answer comes; add the allowance reason text to that notice ("The included model allowance of the agent's owner is used up for today.").
9. **Docs** (same commit):
   - `docs/architecture/spend-limits.md`: a "Built-in allowance" section beside "Spend ceiling" — unit, what counts, hard, daily reset, chart value, holds, refusal text; the units table gets the built-in row.
   - `docs/architecture/connections.md`: link the built-in subsection to it.
   - `docs/ubiquitous-language.md`: **Built-in Allowance**.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass (existing spend tests updated where the unit set grew).
- [ ] A call on a built-in Connection adds its tokens to the owner `token` counter and to `spend_daily`, and nothing to any dollar counter.
- [ ] With the allowance set below today's use, the next built-in call is refused with the allowance text, no approval is created, and a call on an own Connection still passes.
- [ ] A schedule fire on an agent whose default pair is built-in is held with reason `allowance`; one whose default pair is own is not.
- [ ] `spend.status` returns `allowance` with `state: "warn"` at 80% and `"reached"` at 100%.

## Smoke test

On the dev cluster, #4731 merged, images rebuilt, built-in provider on:

1. Send one prompt on the built-in Connection; `dam spend status` shows `usedTokens` > 0 within a few seconds.
2. `helm upgrade` (through `mise run cluster:install` with a values override) with `dailyTokenAllowance` just above `usedTokens`; send prompts until refused.
   Claude Code and Pi each stop after one try and show the allowance text; Home shows no approval card.
3. Ask the agent "how much model allowance do I have left?": it reads it with the spend tool.
