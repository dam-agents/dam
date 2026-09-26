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
        const reason = waitResult.agent.error ?? "unknown";
        const id = opts.showIdOnError ? ` (${waitResult.agent.id})` : "";
        process.stderr.write(
          `error: agent "${opts.name}"${id} entered error state: ${reason}\n`,
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
          `error: timed out waiting for "${opts.name}" to reach running (current: ${waitResult.lastState})\n`,
        );
      }
      return process.exit(EXIT_RUNTIME_FAILURE);
    case "transport":
      process.stderr.write(
        `error: ${formatTransportError(waitResult.reason, opts.host)}\n`,
      );
      return process.exit(EXIT_RUNTIME_FAILURE);
  }
}
