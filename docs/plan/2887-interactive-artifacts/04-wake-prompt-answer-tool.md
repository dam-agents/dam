# 04 — Wake, prompt, and the answer tool

**Depends on:** 03-pod-side-delivery
**Part of:** Interactive Artifacts — see [README](./README.md)

## Context

The slice that joins the two halves: a created request reaches the agent, and the agent's answer
comes back. This is the widest slice by design — waking, prompting and answering are one
behaviour and none of them is verifiable alone. After it, the feature works end to end without a
single line of UI.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Prompt composition.** New `domain/artifact-request-prompt.ts` in the artifact-library
   module, modelled on
   [`invocation-prompt.ts`](../../../packages/api-server/src/modules/invocations/domain/invocation-prompt.ts).
   It states the press, and instructs the agent to call `answer_artifact_request` with the
   request id, saying plainly that finishing the turn is not an answer. On the **first** request
   of an artifact's session it also carries the page's current source; later ones do not, because
   the session already holds it. Decide "first" from whether a session binding exists, which the
   delivery path already knows.
2. **Delivery.** In the requests service, after the row commits, follow the schedule fire
   sequence in
   [`scheduler-runner.ts`](../../../packages/api-server/src/modules/schedules/services/scheduler-runner.ts)
   exactly: `runtimeMutator.bump(agentId, [{ id, kind: "artifact-request", payload, expiresAt }])`,
   `enqueueAfterCommit(agentId)`, then wake. Mark the row `delivered` on success.
   - The agent's absence is not an exception: a deleted agent settles the request `agent_deleted`,
     a wake that gives up settles `wake_failed`, and a start refused for room settles
     `over_budget`. Map the platform's existing typed wake-failure causes onto those reasons
     rather than inventing a parallel taxonomy.
   - An event that expires unanswered settles `expired` through the existing outbox expiry.
3. **The answer tool.** In
   [`mcp-endpoint.ts`](../../../packages/api-server/src/apps/harness-api-server/mcp-endpoint.ts),
   register `answer_artifact_request({ request_id, result })` inside `createMcpSession`, and
   **only when the owner's `interactive-artifacts` flag is on** — this is the session-creation
   check that [features](../../architecture/features.md) says gets reintroduced by the next
   feature carrying an agent surface. Resolve the caller from the existing agent auth; refuse a
   request that is not pending, not for this agent, or already settled, with a message saying
   which. Settling raises the live event from 02.
4. **Where the flag is read.** The MCP session is created per agent, so read the flag for the
   agent's owner at session creation, not per call. A toggle then reaches live agents when their
   session rolls over, exactly as the features page describes.

If this slice will not fit one context window, the clean cut is to land steps 1 and 2 first and
take step 3 as its own follow-on slice depending on this one. Do not split step 2 in half.

## Acceptance criteria

- [ ] Creating a request against a hibernated agent wakes it and delivers the prompt.
- [ ] The agent's `answer_artifact_request` call settles the request as `answered` with the
      result, and raises the live event.
- [ ] The tool is absent from an agent's MCP session when the owner's flag is off.
- [ ] Answering another agent's request, or an already settled one, is refused with a distinct
      message.
- [ ] A deleted agent, a failed wake, and no room each settle with their own named reason.
- [ ] The first request of a session carries the page source; the second does not.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run check && mise run test`, then on the dev cluster with the flag on: publish an
interactive page, call `requests.create` over tRPC, and watch the agent wake, take a turn, and
call the tool. Read the request back and confirm `answered` with the result. Repeat against a
hibernated agent to confirm the wake path, and against a deleted agent to confirm
`agent_deleted`.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
