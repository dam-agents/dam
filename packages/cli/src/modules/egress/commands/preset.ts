import { Command } from "commander";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { EgressService } from "../services/egress-service.js";

export function buildPresetCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createEgressService: (host: string) => EgressService;
}): Command {
  return new Command("preset")
    .description("Show the Agent's current effective network access preset")
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit JSON `{ preset }` instead of a bare string")
    .addHelpText(
      "after",
      "\nExamples:\n  dam network preset my-agent\n  dam network preset my-agent --json\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);

      const agent = await resolveAgentOrExit(
        deps.createAgentService(host),
        ref,
        host,
      );

      const result = await deps
        .createEgressService(host)
        .currentPreset(agent.id);
      exitOnServiceError(result, host);

      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ preset: result.value })}\n`);
      } else {
        process.stdout.write(`${result.value}\n`);
      }
      process.exit(EXIT_SUCCESS);
    });
}
