import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentView } from "../domain/agent-view.js";
import type { AgentService } from "../services/agent-service.js";
import { createAgentResolver } from "../services/agent-resolver.js";
import { fetchOrFallback } from "../services/fetch-or-fallback.js";
import { waitForRunning } from "../services/wait-for-state.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { parseTimeout } from "../../shared/parse-timeout.js";
import { exitCodeForResolveError, printResolveError } from "./errors.js";
import {
  formatTransportError,
  printServiceError,
} from "../../shared/trpc/print.js";
import {
  EXIT_AGENT_NOT_RESOLVED,
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";

const DEFAULT_TIMEOUT_SECONDS = 120;
// Grace before first poll so the controller observes pod deletion before we see stale "running".
const RESTART_GRACE_SECONDS = 2;

export function buildRestartCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
}): Command {
  return new Command("restart")
    .description(
      "Restart an Agent (recreates the pod; persistent volumes survive)",
    )
    .argument("<ref>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--wait", "poll until state == `running` (or terminal error)")
    .option(
      "--timeout <seconds>",
      `--wait timeout in seconds (default ${DEFAULT_TIMEOUT_SECONDS})`,
    )
    .option("--json", "emit raw Agent JSON")
    .addHelpText(
      "after",
      "\nExamples:\n  dam agent restart my-agent\n  dam agent restart my-agent --wait\n",
    )
    .action(
      async (
        ref: string,
        opts: {
          server?: string;
          wait?: boolean;
          timeout?: string;
          json?: boolean;
        },
      ) => {
        await runRestart(ref, opts, deps);
      },
    );
}

type RestartDeps = Parameters<typeof buildRestartCommand>[0];

async function runRestart(
  ref: string,
  opts: { server?: string; wait?: boolean; timeout?: string; json?: boolean },
  deps: RestartDeps,
): Promise<void> {
  const timeoutSeconds = parseTimeout(opts.timeout, DEFAULT_TIMEOUT_SECONDS);
  if (timeoutSeconds === null) {
    process.stderr.write(
      `error: invalid \`--timeout\` value \`${opts.timeout}\`; expected positive integer\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }

  const host = await resolveActiveHost(deps, {
    flag: opts.server ? { server: opts.server } : undefined,
    exitCodes: {
      runtimeFailure: EXIT_RUNTIME_FAILURE,
      belowFloor: EXIT_BELOW_FLOOR,
    },
  });

  const svc = deps.createAgentService(host);
  const resolver = createAgentResolver({ agentService: svc });
  const resolved = await resolver.resolve(ref);
  if (!resolved.ok) {
    printResolveError(resolved.error, host);
    process.exit(exitCodeForResolveError(resolved.error));
  }
  const agent = resolved.value;

  const restartResult = await svc.restart(agent.id);
  if (!restartResult.ok) {
    if (restartResult.error.kind === "not-found") {
      process.stderr.write(`error: no agent with id \`${agent.id}\`\n`);
      process.exit(EXIT_AGENT_NOT_RESOLVED);
    }
    printServiceError(restartResult.error, host);
    process.exit(EXIT_RUNTIME_FAILURE);
  }

  let finalAgent: AgentView | undefined;
  if (opts.wait) {
    let firstStateSeen = false;
    const waitResult = await waitForRunning(svc, agent.id, {
      timeoutSeconds,
      graceSeconds: RESTART_GRACE_SECONDS,
      onStateChange: (state) => {
        if (opts.json) return;
        if (!firstStateSeen) {
          process.stderr.write(
            `Waiting for "${agent.name}"… state: ${state}\n`,
          );
          firstStateSeen = true;
        } else {
          process.stderr.write(`state: ${state}\n`);
        }
      },
    });

    switch (waitResult.kind) {
      case "ready":
        finalAgent = waitResult.agent;
        break;
      case "error":
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(waitResult.agent)}\n`);
        } else {
          const reason = waitResult.agent.error ?? "unknown";
          process.stderr.write(
            `error: agent "${agent.name}" entered error state: ${reason}\n`,
          );
        }
        process.exit(EXIT_RUNTIME_FAILURE);
        return;
      case "timeout":
        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify(await fetchOrFallback(svc, agent, "after restart"))}\n`,
          );
        } else {
          process.stderr.write(
            `error: timed out waiting for "${agent.name}" to reach running (current: ${waitResult.lastState})\n`,
          );
        }
        process.exit(EXIT_RUNTIME_FAILURE);
        return;
      case "transport":
        process.stderr.write(
          `error: ${formatTransportError(waitResult.reason, host)}\n`,
        );
        process.exit(EXIT_RUNTIME_FAILURE);
        return;
    }
  }

  if (opts.json) {
    const payload =
      finalAgent ?? (await fetchOrFallback(svc, agent, "after restart"));
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    const tail = finalAgent ? ` State: ${finalAgent.state}.` : "";
    process.stdout.write(
      `✓ Restarted agent "${agent.name}" (${agent.id}).${tail}\n`,
    );
  }
  process.exit(EXIT_SUCCESS);
}
