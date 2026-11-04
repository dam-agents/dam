import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { printable } from "../../shared/printable.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { renderTable, truncate } from "../../shared/render-table.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { kitRefOf } from "../domain/kit-ref.js";
import type { KitService } from "../services/kit-service.js";

const DESCRIPTION_MAX = 60;

export function buildListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createKitService: (host: string) => KitService;
}): Command {
  return new Command("list")
    .description("List the starter kits on the active host")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--json",
      "emit the kits as JSON, each with `ref`, the Kit Ref other kit commands take",
    )
    .addHelpText(
      "after",
      "\nExamples:\n  dam kit list\n  dam kit list --json | jq '.[].ref'\n",
    )
    .action(async (opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);

      const result = await deps.createKitService(host).list();
      exitOnServiceError(result, host);
      const kits = result.value.map((kit) => ({
        ref: kitRefOf(kit, result.value),
        ...kit,
      }));

      if (opts.json) {
        return writeStdoutAndExit(`${JSON.stringify(kits)}\n`, EXIT_SUCCESS);
      }

      if (kits.length === 0) {
        process.stderr.write(
          "No starter kits.\nhint: a kit from a GitHub repository is shown with `dam kit show <repository-url>`\n",
        );
        process.exit(EXIT_SUCCESS);
      }

      const sorted = [...kits].sort((a, b) => a.name.localeCompare(b.name));
      return writeStdoutAndExit(
        renderTable([
          ["ID", "NAME", "CATEGORY", "DESCRIPTION"],
          ...sorted.map((k) => [
            k.ref,
            printable(k.name),
            printable(k.category),
            truncate(printable(k.tagline ?? k.description), DESCRIPTION_MAX),
          ]),
        ]),
        EXIT_SUCCESS,
      );
    });
}
