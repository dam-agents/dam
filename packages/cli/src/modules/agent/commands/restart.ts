import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentView } from "../domain/agent-view.js";
import type { AgentService } from "../services/agent-service.js";
import { fetchOrFallback } from "../services/fetch-or-fallback.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { parseTimeout } from "../../shared/parse-timeout.js";
import { resolveAgentOrExit } from "./errors.js";
import { waitForRunningOrExit } from "./wait-or-exit.js";
import { printServiceError } from "../../shared/trpc/print.js";
import {
  EXIT_AGENT_NOT_RESOLVED,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";

const DEFAULT_TIMEOUT_SECONDS = 120;
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

  const host = await resolveActiveHost(deps, opts.server);

  const svc = deps.createAgentService(host);
  const agent = await resolveAgentOrExit(svc, ref, host);

  const restartResult = await svc.restart(agent.id);
  if (!restartResult.ok) {
    if (restartResult.error.kind === "not-found") {
      process.stderr.write(`error: no agent with id \`${agent.id}\`\n`);
      process.exit(EXIT_AGENT_NOT_RESOLVED);
    }
    printServiceError(restartResult.error, host);
    process.exit(EXIT_RUNTIME_FAILURE);
  }

  const finalAgent: AgentView | undefined = opts.wait
    ? await waitForRunningOrExit(svc, agent, {
        host,
        name: agent.name,
        timeoutSeconds,
        graceSeconds: RESTART_GRACE_SECONDS,
        json: opts.json,
        showIdOnError: false,
        refreshContext: "after restart",
      })
    : undefined;

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
