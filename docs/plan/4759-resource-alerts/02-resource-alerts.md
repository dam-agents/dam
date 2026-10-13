# 02 — Unattended resource alerts

**Depends on:** 01, and the runner usage read of https://github.com/dam-agents/dam/issues/4757
**Part of:** Resource alerts — see [README](./README.md)

## Context

The usage the web app reads is computed on read, so nothing evaluates it when nobody looks.
This slice adds the unattended evaluation and the repeat limits.

## Implementation plan

1. `packages/db/src/schema.ts`: `resource_alerts(owner_sub, kind, notified_level, notified_at, updated_at)`, key `(owner_sub, kind)`, `kind` storage or runner OOM; generate the migration.
2. `modules/budgets/infrastructure/runner-usage.ts`: list the owners that have a runner usage credential.
3. `modules/resource-alerts/domain/alert-policy.ts`: pure transitions for storage (levels, re-arm below 80%, 24 h interval, one escalation) and OOM (one per episode, 6 h); levels from `poolLevel()` plus the `full` constant.
   A small test file pins the transitions — the one exception to "no new tests", since a state machine's edges have no manual path.
4. `modules/resource-alerts/infrastructure/resource-alerts-repository.ts`: compare-and-set claim and re-arm.
5. `modules/resource-alerts/services/`: the 5-minute storage evaluation, the OOM path from `onAgentChanged` with a short collection window per owner, and the message copy.
6. `bootstrap.ts`: register the periodic job, call the OOM path from the agent watch hook, inject `channelManager.notifyPerson` and the UI base URL.
7. Docs: `budgets.md` (resource alerts), `persistence.md` (the DM at 90/98%), `vm-memory.md` (the DM on an OOM kill), `slack-guarantees.md`.

Apply `/typescript-engineering`.

## Acceptance criteria

- [ ] 91% with a linked owner sends one DM; 92% or 89% sends nothing more; under 80% then 91% within 24 h sends nothing; after 24 h one more; 98% sends once even inside the window.
- [ ] An OOM kill sends one DM naming every affected agent; another within 6 h sends nothing.
- [ ] An unreachable runner sends nothing and changes no state.
- [ ] No runner read on the request path because of this module.

## Smoke test

`mise run //packages/db:check`, `mise run //packages/api-server:check`, `mise run //packages/api-server:test`, `mise run //docs:check`, `mise run //:check:comment-types`.
