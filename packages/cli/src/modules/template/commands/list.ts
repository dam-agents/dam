import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { printServiceError } from "../../agent/commands/errors.js";
import { renderTable } from "../../shared/render-table.js";
import type { TemplateService } from "../services/template-service.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";

const DESCRIPTION_MAX = 60;

export function buildListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createTemplateService: (host: string) => TemplateService;
}): Command {
  return new Command("list")
    .description("List agent templates available on the active host")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n  dam template list\n  dam template list --json | jq '.[].id'\n",
    )
    .action(async (opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });

      const result = await deps.createTemplateService(host).list();
      if (!result.ok) {
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.value)}\n`);
        process.exit(EXIT_SUCCESS);
      }

      if (result.value.length === 0) {
        process.stderr.write(
          "No templates.\nhint: ask your operator to add one to the cluster\n",
        );
        process.exit(EXIT_SUCCESS);
      }

      const sorted = [...result.value].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      process.stdout.write(
        renderTable([
          ["NAME", "ID", "DESCRIPTION"],
          ...sorted.map((t) => [
            t.name,
            t.id,
            truncate(t.description ?? "", DESCRIPTION_MAX),
          ]),
        ]),
      );
      process.exit(EXIT_SUCCESS);
    });
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
