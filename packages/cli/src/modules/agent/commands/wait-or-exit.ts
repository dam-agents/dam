import { isStartRefusal } from "api-server-api";
import type { AgentView } from "../domain/agent-view.js";
import type { AgentService } from "../services/agent-service.js";
import { fetchOrFallback } from "../services/fetch-or-fallback.js";
import { waitForRunning } from "../services/wait-for-state.js";
import { formatTransportError } from "../../shared/trpc/print.js";
import { EXIT_RUNTIME_FAILURE } from "../../shared/exit-codes.js";

export async function waitForRunningOrExit(
  svc: AgentService,
  agent: AgentView,
  opts: {
    host: string;
    name: string;
    timeoutSeconds: number;
    graceSeconds: number;
    json?: boolean;
    showIdOnError: boolean;
    refreshContext: string;
  },
): Promise<AgentView> {
  let firstStateSeen = false;
  const waitResult = await waitForRunning(svc, agent.id, {
    timeoutSeconds: opts.timeoutSeconds,
    graceSeconds: opts.graceSeconds,
    initialState: agent.state,
    onStateChange: (state) => {
      if (opts.json) return;
      if (!firstStateSeen) {
        process.stderr.write(`Waiting for "${opts.name}"… state: ${state}\n`);
        firstStateSeen = true;
      } else {
        process.stderr.write(`state: ${state}\n`);
      }
    },
  });

  switch (waitResult.kind) {
    case "ready":
      return waitResult.agent;
    case "error":
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(waitResult.agent)}\n`);
      } else {
        const id = opts.showIdOnError ? ` (${waitResult.agent.id})` : "";
        process.stderr.write(
          `error: agent "${opts.name}"${id} ${isStartRefusal(waitResult.agent.podTerminationCode) ? "could not start" : "entered error state"}: ${failureReason(waitResult.agent)}\n`,
        );
      }
      return process.exit(EXIT_RUNTIME_FAILURE);
    case "refused":
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(waitResult.agent)}\n`);
      } else {
        const id = opts.showIdOnError ? ` (${waitResult.agent.id})` : "";
        process.stderr.write(
          `error: agent "${opts.name}"${id} could not start: ${refusalReason(waitResult.agent)}\n${REFUSAL_HINT}\n`,
        );
      }
      return process.exit(EXIT_RUNTIME_FAILURE);
    case "timeout":
      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify(await fetchOrFallback(svc, agent, opts.refreshContext))}\n`,
        );
      } else {
        process.stderr.write(
          `error: timed out waiting for "${opts.name}" to reach running (current: ${waitResult.agent.state})\n`,
        );
        if (waitResult.agent.state === "over_budget")
          process.stderr.write(`${refusalReason(waitResult.agent)}\n`);
        else if (waitResult.agent.podTerminationReason)
          process.stderr.write(`${waitResult.agent.podTerminationReason}\n`);
      }
      return process.exit(EXIT_RUNTIME_FAILURE);
    case "transport":
      process.stderr.write(
        `error: ${formatTransportError(waitResult.reason, opts.host)}\n`,
      );
      return process.exit(EXIT_RUNTIME_FAILURE);
  }
}

export const REFUSAL_HINT =
  "hint: disable agents you aren't using to free room, then start this one again; it may also start by itself once room frees";

export function refusalReason(agent: AgentView): string {
  return agent.overBudgetMessage ?? "your agents' resources are in use";
}

export function failureReason(agent: AgentView): string {
  return agent.error ?? agent.podTerminationReason ?? "unknown";
}

export async function startFailure(
  svc: AgentService,
  agentId: string,
): Promise<string | null> {
  const now = await svc.get(agentId);
  if (!now.ok || now.value === null) return null;
  if (now.value.state === "over_budget") return refusalReason(now.value);
  if (now.value.state === "error") return failureReason(now.value);
  return null;
}
