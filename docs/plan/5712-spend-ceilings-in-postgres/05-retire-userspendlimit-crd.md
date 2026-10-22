# 05 — Retire the UserSpendLimit CRD

**Depends on:** 02-ceilings-in-postgres
**Part of:** Spend ceilings in Postgres, set by platform operators — see [README](./README.md)

## Context

After 02, nothing reads `UserSpendLimit` objects, but the chart still ships the CRD, the controller still registers the Go type, and the api-server's Role still grants `get` on it.
This slice removes all of it, so a chart upgrade no longer carries a cluster-wide type for an app setting.
The CRD that is already on the shared cluster stays until a cluster admin deletes it after the merge ([Delivery](./README.md#delivery)); this slice does not do that.

## Implementation plan

1. **Chart CRD** — delete [`helm/crds/agent-platform.ai_userspendlimits.yaml`](../../../helm/crds/agent-platform.ai_userspendlimits.yaml).
2. **Go type** — delete [`packages/controller/api/v1/user_spend_limit_types.go`](../../../packages/controller/api/v1/user_spend_limit_types.go), and remove `&UserSpendLimit{}, &UserSpendLimitList{}` from the scheme registration in [`groupversion_info.go`](../../../packages/controller/api/v1/groupversion_info.go).
   Regenerate with `mise run //packages/controller:fix:crds`, which rewrites `zz_generated.deepcopy.go`; confirm that it does not bring the CRD file back.
3. **Schema generation** — [`schema_generation.go`](../../../packages/controller/api/v1/schema_generation.go): remove `UserSpendLimitSchemaGeneration` and its comment line.
   [`schema_generation_test.go`](../../../packages/controller/api/v1/schema_generation_test.go): remove the `agent-platform.ai_userspendlimits.yaml` entry.
4. **RBAC** — [`helm/templates/apiserver/rbac.yaml`](../../../helm/templates/apiserver/rbac.yaml): remove the `userspendlimits` rule and its comment.
5. **Values text** — [`helm/values.yaml`](../../../helm/values.yaml), `apiServer.spend.defaultUserCeilingUsd`: replace "A UserSpendLimit object overrides it for one user."
   with a sentence that says a platform operator overrides it for one user, with `dam spend ceiling` or in Settings › Operator.
6. **Glossary** — [`docs/ubiquitous-language.md`](../../ubiquitous-language.md): delete the `UserSpendLimit` row, and in the `Spend Ceiling` row replace "Resolved as the user's UserSpendLimit" with the ceiling that a platform operator set for the user.
7. **Last mentions** — `git grep -n -i "userspendlimit\|spend-limit-<"` must find nothing outside `docs/adrs/` and this plan folder.
   Leave the ADRs as they are: they are history.
8. **CRD compatibility** — no release tag shipped this CRD (the latest `v*` tag at planning time, `v0.2.23-rc4`, does not have it), so `check:crd-backwards-compatibility` needs no `removed_ok` entry.
   Check again at implementation time: if a newer `v*` tag has `agent-platform.ai_userspendlimits.yaml`, add it to `removed_ok` in [`packages/controller/.mise/tasks/check/crd-backwards-compatibility`](../../../packages/controller/.mise/tasks/check/crd-backwards-compatibility) with a short reason, as the `forks` and `runs` entries have.

## Acceptance criteria

- [ ] `helm/crds/` has no `userspendlimits` file, and the rendered chart has no `userspendlimits` rule.
- [ ] The controller builds and its tests pass with the type gone; `zz_generated.deepcopy.go` has no `UserSpendLimit` methods.
- [ ] `mise run //packages/controller:check:crds`, `mise run //packages/controller:check:crd-schema-generation` and `mise run //packages/controller:check:crd-backwards-compatibility` pass.
- [ ] The grep in step 7 finds nothing outside `docs/adrs/` and `docs/plan/`.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

Run it yourself, then print a short guide so the user can repeat it:

1. `mise run //helm:check:render` passes, and the rendered output has no `userspendlimits`.
2. Run the three controller CRD checks from the acceptance criteria.
3. On a fresh local dev cluster install of the branch (`cluster-ops` skill), `mise run cluster:kubectl -- get crd userspendlimits.agent-platform.ai` returns NotFound, and the spend ceiling commands from 03 still work.
4. On a cluster that still has the old CRD, the new api-server starts and the ceiling commands work; the old CRD and its objects are simply unused.
