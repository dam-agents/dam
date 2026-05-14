import { Command } from "commander";
import type { Instance } from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { InstanceService } from "../services/instance-service.js";
import type {
  AuthRequiredError,
  TransportError,
} from "../domain/errors.js";
import {
  describeConfigError,
  formatTransportError,
  printCompatResolveError,
} from "./errors.js";
import {
  EXIT_INSTANCE_BELOW_FLOOR,
  EXIT_INSTANCE_RUNTIME_FAILURE,
  EXIT_INSTANCE_SUCCESS,
} from "./exit-codes.js";

export interface ListCommandDeps {
  compatService: CompatService;
  configService: ConfigService;
  /** Per-host factory — produced by the module's compose. Called once
   *  per command invocation against the resolved Active Host. */
  createInstanceService: (host: string) => InstanceService;
  /** Env var name for the server URL — surfaced in the
   *  `no server configured` hint. */
  serverEnvVar: string;
}

export function buildListCommand(deps: ListCommandDeps): Command {
  return new Command("list")
    .description("List your Instances")
    .option("--server <url>", "override the configured server URL for this call")
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n  dam instance list\n  dam instance list --json\n",
    )
    .action(async (opts: { server?: string; json?: boolean }) => {
      const flag = opts.server ? { server: opts.server } : undefined;

      // Compat pre-flight — same gate `ping` and `auth login` use.
      // Matches `ping`: all compat-resolve failures (missing-config,
      // malformed-config, probe-error) exit as runtime failure so the
      // exit code is consistent across commands that share this gate.
      const compat = await deps.compatService.check({ flag });
      if (!compat.ok) {
        printCompatResolveError(compat.error, deps.serverEnvVar);
        process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
      }
      const verdict = compat.value;
      if (verdict.kind === "below-floor") {
        process.stderr.write(
          `error: CLI ${verdict.localCli} is below the server's minimum required version ${verdict.serverMinClient}; upgrade and retry\n`,
        );
        process.exit(EXIT_INSTANCE_BELOW_FLOOR);
      }
      if (verdict.kind === "behind-current") {
        process.stderr.write(
          `warning: CLI ${verdict.localCli} is behind server ${verdict.serverVersion}; consider upgrading\n`,
        );
      }

      // Resolve host. The Config file existed at compat time, so a
      // failure here is the rare malformed-mid-flight case — surface it
      // as a runtime failure.
      const cfg = await deps.configService.getResolved({ flag });
      if (!cfg.ok) {
        process.stderr.write(`error: ${describeConfigError(cfg.error)}\n`);
        process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
      }

      const host = cfg.value.server;
      const svc = deps.createInstanceService(host);
      const result = await svc.list();
      if (!result.ok) {
        printServiceError(result.error, host);
        process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
      }

      if (opts.json) {
        // Always emit `[]` on empty regardless of TTY — scripts consume
        // this unconditionally.
        process.stdout.write(`${JSON.stringify(result.value)}\n`);
        process.exit(EXIT_INSTANCE_SUCCESS);
      }

      if (result.value.length === 0) {
        // Matches `kubectl get pods` / `gh pr list` conventions: stderr
        // note, empty stdout, exit 0.
        process.stderr.write("No instances.\n");
        process.stderr.write(
          "hint: create one with `dam instance create <name> --template <id>`\n",
        );
        process.exit(EXIT_INSTANCE_SUCCESS);
      }

      process.stdout.write(renderTable(result.value));
      process.exit(EXIT_INSTANCE_SUCCESS);
    });
}

/** Default human format: 4 columns, alphabetical by name, no truncation. */
function renderTable(instances: readonly Instance[]): string {
  const sorted = [...instances].sort((a, b) => a.name.localeCompare(b.name));
  const rows = [
    ["NAME", "ID", "TEMPLATE", "STATE"],
    ...sorted.map((i) => [i.name, i.id, i.templateId ?? "<custom>", i.state]),
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

function printServiceError(error: TransportError | AuthRequiredError, host: string): void {
  if (error.kind === "auth-required") {
    process.stderr.write(`error: not authenticated: ${error.reason}\n`);
    process.stderr.write("hint: run `dam auth login` first\n");
    return;
  }
  process.stderr.write(`error: ${formatTransportError(error.reason, host)}\n`);
}
