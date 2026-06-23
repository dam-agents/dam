import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentService } from "../services/agent-service.js";
import { renderTable } from "../../shared/render-table.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { printServiceError } from "../../shared/trpc/print.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";

export function buildListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
}): Command {
  return new Command("list")
    .description("List your Agents")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n  dam agent list\n  dam agent list --json\n",
    )
    .action(async (opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });

      const result = await deps.createAgentService(host).list();
      if (!result.ok) {
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        return writeStdoutAndExit(
          `${JSON.stringify(result.value)}\n`,
          EXIT_SUCCESS,
        );
      }

      if (result.value.length === 0) {
        process.stderr.write(
          "No agents.\nhint: create one with `dam agent create <name> --template <id>`\n",
        );
        process.exit(EXIT_SUCCESS);
      }

      const sorted = [...result.value].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      return writeStdoutAndExit(
        renderTable([
          ["NAME", "ID", "TEMPLATE", "STATE"],
          ...sorted.map((a) => [
            a.name,
            a.id,
            a.templateId ?? "<custom>",
            a.state,
          ]),
        ]),
        EXIT_SUCCESS,
      );
    });
}
