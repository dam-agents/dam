import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentService } from "../services/agent-service.js";
import { renderTable } from "../../shared/render-table.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";

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
    .option(
      "--outdated",
      "list only the agents pinned to an image older than their template's, with the image and the last time each said hello",
    )
    .addHelpText(
      "after",
      "\nExamples:\n  dam agent list\n  dam agent list --json\n  dam agent list --outdated\n",
    )
    .action(
      async (opts: { server?: string; json?: boolean; outdated?: boolean }) => {
        const host = await resolveActiveHost(deps, opts.server);

        if (opts.outdated) {
          const fleet = await deps.createAgentService(host).runtimeFleet();
          exitOnServiceError(fleet, host);
          if (opts.json)
            return writeStdoutAndExit(
              `${JSON.stringify(fleet.value)}\n`,
              EXIT_SUCCESS,
            );
          if (fleet.value.outdated.length === 0) {
            process.stderr.write(
              `All ${fleet.value.onCurrent} agents run their template's current image.\n`,
            );
            process.exit(EXIT_SUCCESS);
          }
          return writeStdoutAndExit(
            `${renderTable([
              ["NAME", "ID", "IMAGE", "TEMPLATE IMAGE", "LAST HELLO"],
              ...fleet.value.outdated.map((a) => [
                a.name,
                a.agentId,
                a.image,
                a.templateImage,
                a.lastHello ?? "never",
              ]),
            ])}\n${fleet.value.onCurrent} on the current image, ${fleet.value.outdated.length} behind.\n`,
            EXIT_SUCCESS,
          );
        }

        const result = await deps.createAgentService(host).list();
        exitOnServiceError(result, host);

        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify(result.value)}\n`,
            EXIT_SUCCESS,
          );
        }

        if (result.value.length === 0) {
          process.stderr.write(
            "No agents.\nhint: create one with `dam agent create <name> --template <id> --provider <connection-id>`\n",
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
      },
    );
}
