import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentService } from "../services/agent-service.js";
import { createAgentResolver } from "../services/agent-resolver.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import {
  exitCodeForResolveError,
  printResolveError,
  printServiceError,
} from "./errors.js";
import { confirm, exitCancelled } from "../../shared/prompt.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";

export function buildDeleteCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
}): Command {
  return new Command("delete")
    .description("Delete an Agent and all its persistent data")
    .argument("<ref>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("-y, --yes", "skip the confirmation prompt")
    .option(
      "--json",
      "emit { deleted, id, name } or { cancelled: true } as JSON",
    )
    .addHelpText(
      "after",
      "\nExamples:\n  dam agent delete my-agent\n  dam agent delete agent-abc123 --yes\n",
    )
    .action(
      async (
        ref: string,
        opts: { server?: string; yes?: boolean; json?: boolean },
      ) => {
        await runDelete(ref, opts, deps);
      },
    );
}

type DeleteDeps = Parameters<typeof buildDeleteCommand>[0];

async function runDelete(
  ref: string,
  opts: { server?: string; yes?: boolean; json?: boolean },
  deps: DeleteDeps,
): Promise<void> {
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

  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      process.stderr.write(
        "error: delete requires confirmation; pass `--yes` or run interactively\n",
      );
      process.exit(EXIT_INVALID_INPUT);
    }
    const proceed = await confirm(
      `Delete agent "${agent.name}"? This destroys all persistent data and cannot be undone.`,
    );
    if (!proceed) exitCancelled(opts);
  }

  // Agent is the single resource — no separate Instance to
  // orphan, so deleteAgent is the only path.
  const result = await svc.deleteAgent(agent.id);
  let alreadyGone = false;
  if (!result.ok) {
    if (result.error.kind === "not-found") {
      alreadyGone = true;
    } else {
      printServiceError(result.error, host);
      process.exit(EXIT_RUNTIME_FAILURE);
    }
  }

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({
        deleted: true,
        id: agent.id,
        name: agent.name,
        alreadyGone,
      })}\n`,
    );
  } else if (alreadyGone) {
    process.stdout.write(
      `✓ Deleted agent "${agent.name}" (was already gone).\n`,
    );
  } else {
    process.stdout.write(`✓ Deleted agent "${agent.name}".\n`);
  }
  process.exit(EXIT_SUCCESS);
}
