# 01 — UserBudget overrides the VM pool

**Part of:** Per-user VM pools — see [README](./README.md)

## Context

The owner's pool needs one place to be read from.
This slice adds the `storage` field, makes `cpu`/`memory` optional, resolves the owner's pool, and uses its storage ceiling for the runner claim.

## Implementation plan

1. `packages/controller/api/v1/user_budget_types.go`: `CPU` and `Memory` become `*resource.Quantity` with `+optional`; add `Storage *resource.Quantity` with the same positivity rule. Describe that each also sets the VM pool.
2. Bump `UserBudgetSchemaGeneration` to 2 in `api/v1/schema_generation.go` and on the marker; `mise run //packages/controller:fix:crds`.
3. `pkg/reconciler/budget.go` `ceilingFor`: fall back per field.
4. New owner pool in `pkg/reconciler`: read `budget-<owner>`, take each set field, else the install's runner `limits.memory`, `limits.cpu`, `runner.storage`. Keep the last resolved pool per owner in memory; refresh it at the start of each vm agent reconcile.
5. `vm_runner_sizing.go` `runnerClaimSize`: ceiling from the owner's pool.
6. `packages/api-server/src/modules/budgets/infrastructure/user-budgets.ts`: return the fields that are set; the services merge them over the default ceiling field by field.
7. Docs: `budgets.md` (The Ceiling), `persistence.md` (claim ceiling).

## Acceptance criteria

- [ ] A UserBudget with only `storage` is admitted; one with `storage: 0` is refused.
- [ ] A raised `storage` raises only that owner's claim ceiling; a lowered one shrinks no claim.
- [ ] The container ceiling is unchanged for budgets that set `cpu` and `memory`, and falls back per field when one is missing (controller and api-server).
- [ ] CRD compatibility and schema-generation checks pass.

## Smoke test

`mise run //packages/controller:check`, `mise run //packages/controller:test`, `mise run //packages/api-server-api:check`, `mise run //packages/api-server:test`, `mise run //docs:check`.
