import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { InstanceService } from "../services/instance-service.js";
import { renderTable } from "../../shared/render-table.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { printServiceError } from "./errors.js";
import {
  EXIT_INSTANCE_BELOW_FLOOR,
  EXIT_INSTANCE_RUNTIME_FAILURE,
  EXIT_INSTANCE_SUCCESS,
} from "./exit-codes.js";

export function buildListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createInstanceService: (host: string) => InstanceService;
}): Command {
  return new Command("list")
    .description("List your Instances")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n  dam instance list\n  dam instance list --json\n",
    )
    .action(async (opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_INSTANCE_RUNTIME_FAILURE,
          belowFloor: EXIT_INSTANCE_BELOW_FLOOR,
        },
      });

      const result = await deps.createInstanceService(host).list();
      if (!result.ok) {
        printServiceError(result.error, host);
        process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.value)}\n`);
        process.exit(EXIT_INSTANCE_SUCCESS);
      }

      if (result.value.length === 0) {
        process.stderr.write(
          "No instances.\nhint: create one with `dam instance create <name> --template <id>`\n",
        );
        process.exit(EXIT_INSTANCE_SUCCESS);
      }

      const sorted = [...result.value].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      process.stdout.write(
        renderTable([
          ["NAME", "ID", "TEMPLATE", "STATE"],
          ...sorted.map((i) => [
            i.name,
            i.id,
            i.templateId ?? "<custom>",
            i.state,
          ]),
        ]),
      );
      process.exit(EXIT_INSTANCE_SUCCESS);
    });
}
