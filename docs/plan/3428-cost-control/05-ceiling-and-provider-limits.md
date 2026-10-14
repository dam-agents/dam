# 05 — Ceiling, own limit, provider limits

**Depends on:** 04-agent-limit-and-refusal
**Part of:** Cost control — see [README](./README.md)

## Context

This slice completes the set of limits (D3, D15).
The owner gets a daily dollar limit for all own agents, and a daily limit per agent and Connection in that Connection's unit.
The operator gets a hard spend ceiling per user: a Helm default, off at first, plus a `UserSpendLimit` object for each exception, the same way as `UserBudget`.
The first limit reached stops the work.
The ceiling refuses without a question.
The tables exist since slice 04, so this slice needs no migration.

## Implementation plan

Apply `/typescript-engineering` for server, contract and CLI code.
The CRD is Go in `packages/controller/api/v1/`.

1. **`UserSpendLimit` CRD**, following `user_budget_types.go`:
   - A new file `packages/controller/api/v1/user_spend_limit_types.go`.
     - Spec: `owner` (the exact Keycloak sub, as on UserBudget) and `dailyUsd`, a decimal string with up to 2 decimals (pattern-validated; CRDs avoid floats).
       The owner has at most 241 characters, not 246 as on UserBudget, because the prefix `spend-limit-` has 12 characters and the name must stay a valid object name.
       `dailyUsd` has at most 7 whole digits, so the micro-unit amount stays a safe integer; the api-server parses it with the same rule.
     - Name pinned by a CEL rule to `spend-limit-<spec.owner>`, so there is one per user.
     - Markers: namespaced, `helm.sh/resource-policy=keep`, `agent-platform.ai/crd-schema-generation=1`, and print columns for owner and daily USD.
     - No status.
   - Register it in `groupversion_info.go`.
   - Add a `UserSpendLimitSchemaGeneration = 1` constant in `schema_generation.go`, and its CRD file in the existing map of `schema_generation_test.go`.
   - Run `mise run //packages/controller:fix:crds`.
     It writes the deepcopy code and `helm/crds/agent-platform.ai_userspendlimits.yaml`.
   - The controller does not read this CRD.
     Do not add it to `pkg/crdcheck`.
   - `helm/templates/apiserver/rbac.yaml`: `get` on `userspendlimits`, next to `userbudgets`.
     The local install applies all of `helm/crds/` (`.mise/tasks/cluster/install`), so the new CRD reaches the dev cluster.
2. **Helm default ceiling.**
   - `helm/values.yaml`: `apiServer.spend.defaultUserCeilingUsd: null` (off).
   - It goes to an env var in `helm/templates/apiserver/app.yaml`, then to `packages/api-server/src/config.ts`.
3. **Ceiling reader** (spend module, infrastructure).
   - `k8s.getCustomObject("userspendlimits", "spend-limit-" + owner)`, as `readUserBudgetCeiling` does.
   - Cache each owner's value for 60 seconds, because the gate needs it on every billable call.
     A 404 means: use the Helm default.
     When a read fails, keep the last value read; with no earlier value, the gate fails closed.
4. **Limit rules** (extend slice 04's domain rules):
   - Owner limit: the owner's `usd` counter against the owner limit, with its extensions.
   - Connection limit: the counter of the agent and Connection, in the Connection's unit, against that limit.
   - Ceiling: the owner's `usd` counter against the ceiling.
     It is hard: no extensions and no approval.
   - All limits are checked.
     Any reached limit refuses the call.
     When the ceiling is reached, use the ceiling text and ask nothing, also when soft limits are reached too.
     When only soft limits are reached, use the soft text, and ask once for each reached soft limit.
   - A Connection in the unit `free` has no limits.
     A Connection that is not metered (`custom-header`) cannot get a limit.
     An `openai` or `bedrock` Connection cannot get a Connection limit in this feature, because its calls are not priced.
   - `usd_list` and `bobcoin` Connections count only in their own Connection limit, never in the agent limit, the own limit or the ceiling.
   - The provider-to-unit table and the rule for which Connections take a limit (`connectionLimitRule`) live in the contract package, so the CLI and the slice 07 screens use the same rule.
5. **Contract.**
   - Add the `owner` and `connection` kinds to the `scope` of `spend.setLimit`.
     For `connection`: the Connection must be granted to the agent and must be metered and not free.
     The unit comes from the Connection's template.
   - Add the `ceiling` object to `spend.status`.
6. **One blocked check** in the spend service, for slice 06.
   Input: the payer agent and, optionally, a Connection.
   Output: nothing, or the reason (a soft limit, or the ceiling).
   It uses the same rules as the gate.
   It is `SpendCheck.blockedFor({ payer, connectionId? })`, which returns `"limit"`, `"ceiling"` or `null`.
7. **CLI**:
   - `dam spend limit set --me --usd <amount>`;
   - `dam spend limit set <agent> --connection <id-or-name> --amount <amount>` (print the unit);
   - `dam spend limit clear` with the same scopes;
   - `dam spend status --me` shows the own limit and the ceiling.
8. **Docs** (same commit):
   - `docs/architecture/spend-limits.md`: sections "Own limit", "Connection limits" (the units and which limits each unit counts in) and "Spend ceiling" (Helm default, `UserSpendLimit` with a YAML example like the one in `budgets.md`, hard, operator-managed, the lower of the ceiling and the own limit wins).
   - `docs/architecture/budgets.md`: one sentence in the overview: the Budget limits compute, and spend has its own ceiling on the spend-limits page.
   - `docs/ubiquitous-language.md`: **Spend Ceiling** and **UserSpendLimit**.
     Make clear that "Ceiling" alone stays the compute ceiling.
   - `docs/architecture/cli.md`: the new flags.
   - Bump `Last verified:`, and run `mise run fix:markdown`.
9. **Bob refusal body** (found in the smoke test, 2026-10-14).
   Bob Shell reads only `error.message` from a JSON error body, and otherwise shows the status text "Bad Request".
   So a refusal on a Bob Connection carries the text as `{"error":{"message":"<text>"}}` with `content-type: application/json`; other providers keep plain text, because Pi shows a JSON body raw.

## Acceptance criteria

- [x] `mise run //packages/controller:check` passes (`check:crds`, schema generation, CRD compatibility).
- [x] A `UserSpendLimit` with a wrong name is refused at admission.
- [x] With a ceiling below today's spend, the next billable call is refused with the ceiling text, and no approval appears.
- [x] With an own limit below today's spend, a call of any own agent is refused with the soft text, and one approval for the own limit appears.
- [x] A Connection limit on a Bob or subscription Connection counts only that Connection's calls, in Bobcoins or list-price dollars.
  The agent's dollar limit does not count them.
- [x] `dam spend status --me` shows the own limit, the ceiling and its source (`default` or `UserSpendLimit`).
- [x] `mise run check`, `mise run test` and `mise run check:comment-types` pass (the tests scoped to the touched packages; the full run is the whole-feature gate).

## Smoke test

On the dev cluster:

1. `mise run cluster:build -- api-server`, then apply the new CRD (`mise run cluster:helm`, or the install step in `cluster-ops`).
2. `dam spend status --me`: no own limit, ceiling off.
3. Apply a `UserSpendLimit` for your dev user with `dailyUsd: "0.01"`, using `mise run cluster:kubectl -- apply -f <file>`.
   Within 60 seconds, a prompt is refused with "Ask the platform operator for a higher ceiling", and `dam approval list` shows no new row.
   Delete the object.
4. `dam spend limit set --me --usd 0.01`.
   A prompt in any own agent is refused with the soft text, and one approval appears.
   Clear the limit.
5. If a Bob or Claude subscription Connection exists:
   `dam spend limit set <agent> --connection <id> --amount 0.00001`.
   A prompt on that Connection is refused, and a prompt on another Connection of the same agent works.

Then print a short guide for Petr, so that he can repeat steps 3 and 4 by hand.
