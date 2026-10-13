# 03 — A runner OOM kill shows on each affected agent

**Part of:** #4755 — see [README](./README.md)

## Context

When the runner is OOM-killed, every machine dies with it and the agents read as "starting" with no reason.
This slice reads the kill off the runner pod and stamps a reason on each agent it took down, which the existing crash notice shows.

## Implementation plan

1. `packages/controller/api/v1/agent_types.go`: `ReasonRunnerOutOfMemory = "RunnerOutOfMemory"`.
   Not `Machine*`, which the api-server reads as terminal.
2. `pod_termination.go`: `runnerOOMKilledAt(pod)` from the runner container's `State.Terminated` or `LastTerminationState.Terminated` with reason `OOMKilled`.
3. Read the runner pod from a cache: a runner-pod informer next to the runner Deployment informer in `main.go`, whose updates requeue the owner's vm agents.
4. `vm_runner.go` `runnerNotReady`: the reason and its message when the runner pod was OOM-killed.
5. `vm_agent.go` `publishVMReadiness`: a pure, sticky rule — an agent that should run, whose machine is not ready yet, and whose AgentPodReady was already `RunnerOutOfMemory` or was True at or before the kill, carries the reason with "its owner's VM memory ran out, so every VM agent of theirs that was running restarted; stop agents you are not using to free memory".
   It clears once the agent is ready.
6. api-server: `RunnerOutOfMemory` in `POD_FAILURE_REASONS` and `describeWakeFailure` (`packages/api-server/src/modules/agents/domain/wake-failure.ts`), and channel copy in `modules/channels/infrastructure/wake-failure-copy.ts`.
   The agent state stays "starting".
7. Docs: `vm-memory.md` ("What can still go wrong") and `vm-runner.md` (what an agent waits for).

## Acceptance criteria

- [ ] A runner pod whose last termination is OOMKilled, and an agent that was Ready, yields AgentPodReady=False / `RunnerOutOfMemory` while the runner is down and while the machine boots; it clears when the agent is ready.
- [ ] No stamp on an agent woken after the kill, or after a restart that was not an OOM.
- [ ] The api-server describes it with the text that suggests stopping agents, and keeps the state "starting".

## Smoke test

`mise run //packages/controller:test`, `mise run //packages/controller:check`, `mise run //packages/api-server:test`, `mise run //packages/api-server:check`, `mise run //docs:check`.
