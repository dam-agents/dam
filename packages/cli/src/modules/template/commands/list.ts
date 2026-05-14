import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type {
  AuthRequiredError,
  TransportError,
} from "../../instance/domain/errors.js";
import {
  describeConfigError,
  formatTransportError,
  printCompatResolveError,
} from "../../instance/commands/errors.js";
import type { Template, TemplateService } from "../services/template-service.js";
import {
  EXIT_TEMPLATE_BELOW_FLOOR,
  EXIT_TEMPLATE_RUNTIME_FAILURE,
  EXIT_TEMPLATE_SUCCESS,
} from "./exit-codes.js";

const DESCRIPTION_MAX = 60;

export interface ListCommandDeps {
  compatService: CompatService;
  configService: ConfigService;
  /** Per-host factory — produced by the module's compose. */
  createTemplateService: (host: string) => TemplateService;
  /** Env var name for the server URL — surfaced in the
   *  `no server configured` hint. */
  serverEnvVar: string;
}

export function buildListCommand(deps: ListCommandDeps): Command {
  return new Command("list")
    .description("List agent templates available on the active host")
    .option("--server <url>", "override the configured server URL for this call")
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n  dam template list\n  dam template list --json | jq '.[].id'\n",
    )
    .action(async (opts: { server?: string; json?: boolean }) => {
      const flag = opts.server ? { server: opts.server } : undefined;

      const compat = await deps.compatService.check({ flag });
      if (!compat.ok) {
        printCompatResolveError(compat.error, deps.serverEnvVar);
        process.exit(EXIT_TEMPLATE_RUNTIME_FAILURE);
      }
      const verdict = compat.value;
      if (verdict.kind === "below-floor") {
        process.stderr.write(
          `error: CLI ${verdict.localCli} is below the server's minimum required version ${verdict.serverMinClient}; upgrade and retry\n`,
        );
        process.exit(EXIT_TEMPLATE_BELOW_FLOOR);
      }
      if (verdict.kind === "behind-current") {
        process.stderr.write(
          `warning: CLI ${verdict.localCli} is behind server ${verdict.serverVersion}; consider upgrading\n`,
        );
      }

      const cfg = await deps.configService.getResolved({ flag });
      if (!cfg.ok) {
        process.stderr.write(`error: ${describeConfigError(cfg.error)}\n`);
        process.exit(EXIT_TEMPLATE_RUNTIME_FAILURE);
      }

      const host = cfg.value.server;
      const svc = deps.createTemplateService(host);
      const result = await svc.list();
      if (!result.ok) {
        printServiceError(result.error, host);
        process.exit(EXIT_TEMPLATE_RUNTIME_FAILURE);
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.value)}\n`);
        process.exit(EXIT_TEMPLATE_SUCCESS);
      }

      if (result.value.length === 0) {
        process.stderr.write("No templates.\n");
        process.stderr.write("hint: ask your operator to add one to the cluster\n");
        process.exit(EXIT_TEMPLATE_SUCCESS);
      }

      process.stdout.write(renderTable(result.value));
      process.exit(EXIT_TEMPLATE_SUCCESS);
    });
}

function renderTable(templates: readonly Template[]): string {
  const sorted = [...templates].sort((a, b) => a.name.localeCompare(b.name));
  const rows = [
    ["NAME", "ID", "DESCRIPTION"],
    ...sorted.map((t) => [t.name, t.id, truncate(t.description ?? "", DESCRIPTION_MAX)]),
  ];
  const widths = rows[0]!.map((_, col) =>
    Math.max(...rows.map((r) => r[col]!.length)),
  );
  const pad = (s: string, w: number) => s + " ".repeat(w - s.length);
  return rows
    .map((row) =>
      row.map((cell, col) => (col === row.length - 1 ? cell : pad(cell, widths[col]!))).join("   "),
    )
    .join("\n") + "\n";
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function printServiceError(error: TransportError | AuthRequiredError, host: string): void {
  if (error.kind === "auth-required") {
    process.stderr.write(`error: not authenticated: ${error.reason}\n`);
    process.stderr.write("hint: run `dam auth login` first\n");
    return;
  }
  process.stderr.write(`error: ${formatTransportError(error.reason, host)}\n`);
}
