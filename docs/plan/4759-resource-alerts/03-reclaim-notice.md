# 03 — A reclaimed agent says why it is asleep

**Part of:** Resource alerts — see [README](./README.md)

## Context

The platform puts idle agents to sleep early to admit a start or relieve memory pressure, and today the user cannot tell that from a lapsed timeout.
This slice surfaces the controller's existing `reclaimed-at` annotation.

## Implementation plan

1. `packages/api-server/src/modules/agents/infrastructure/labels.ts`: the annotation key.
2. `agent-mappers.ts`: derive `reclaimed { at, for }` when the agent is hibernated, the stamp parses and `last-activity` is not newer; `for` is `memory` for a vm agent, `compute` otherwise.
3. `packages/api-server-api` agent types and view, and the UI `AgentView`: the field.
4. UI (`packages/ui/src/modules/agents/`): the unavailable overlay's description, a status tooltip on the row, and a toast when an agent newly gains `reclaimed`, beside the crash notices.
5. ADR through the `adr` skill, superseding the "reclamation is silent" decision; `budgets.md` and `vm-memory.md` say a reclaimed agent says so.

Apply `/typescript-engineering` and `/react-ui-engineering`.

## Acceptance criteria

- [ ] A reclaimed agent shows the reason in its overlay and row until newer activity.
- [ ] An agent hibernated by its own timeout shows nothing new.
- [ ] One toast per reclaim, not per poll.
- [ ] No controller or CRD change.

## Smoke test

`mise run //packages/api-server:test`, `mise run //packages/api-server-api:check`, `mise run //packages/ui:check`, `mise run //packages/ui:test`, `mise run //docs:check`.
Manually on a cluster: run more vm agents than the pool holds and see the idle one say it was put to sleep early.
