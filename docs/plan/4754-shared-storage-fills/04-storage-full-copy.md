# 04 — Users read why storage stopped their agent

**Depends on:** 01-storage-full-reason
**Part of:** #4754 — see [README](./README.md)

## Context

The api-server ends a wake only on reasons it knows, and describes each; the new reason must end a wake at once and say what to do.

## Implementation plan

Apply `/typescript-engineering`.

1. `packages/api-server/src/modules/agents/domain/wake-failure.ts`: add `MachineStorageFull` to `POD_FAILURE_REASONS` and a description.
2. `packages/api-server/src/modules/channels/infrastructure/wake-failure-copy.ts`: copy naming the fixes — delete an agent you no longer need, clear caches inside your agents, or ask an admin for more storage.
3. Not an image start failure, so `IMAGE_START_FAILURES` stays as it is; `TERMINAL_MACHINE_REASONS` picks the reason up.

## Acceptance criteria

- [ ] The vocabulary test and wake-failure tests pass.
- [ ] An agent with the reason reads `error`, with the runner's message.

## Smoke test

`mise run //packages/api-server:test`.
