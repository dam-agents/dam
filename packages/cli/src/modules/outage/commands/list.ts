import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { OutageRead, OutageService } from "../services/outage-service.js";

function providerLines(read: OutageRead): string[] {
  const { damSide, outages, checkedAt } = read.providerStatus;
  const lines: string[] = [];
  if (damSide)
    lines.push(
      `  the platform cannot reach model providers since ${damSide.since}`,
    );
  for (const outage of outages)
    lines.push(
      `  ${outage.templateId}  ${outage.reason}  since ${outage.since}  ${outage.statusPageUrl ?? "-"}`,
    );
  if (lines.length === 0) lines.push("  no provider is having problems");
  lines.push(
    checkedAt === null
      ? "  not checked in the last three minutes"
      : `  checked ${checkedAt}`,
  );
  return lines;
}

function alertLines(read: OutageRead): string[] {
  if (read.alerts.length === 0) return ["  none"];
  return read.alerts.flatMap((alert) => [
    `  ${alert.templateId}  since ${alert.since}${alert.recoveredAt === null ? "" : `  recovered ${alert.recoveredAt}`}`,
    ...alert.agents.map(
      (agent) => `    ${agent.name} (${agent.affectedBy.join(", ")})`,
    ),
  ]);
}

function renderText(read: OutageRead): string {
  return [
    "Providers",
    ...providerLines(read),
    "",
    "Your outage alerts",
    ...alertLines(read),
    "",
  ].join("\n");
}

export function buildListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createOutageService: (host: string) => OutageService;
}): Command {
  return new Command("list")
    .description(
      "List the model provider outages and your outage alerts — the same causes the bell shows",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the status and the alerts as one JSON object")
    .addHelpText(
      "after",
      "\nExamples:\n  dam outage list\n  dam outage list --json\n",
    )
    .action(async (opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);
      const read = await deps.createOutageService(host).read();
      exitOnServiceError(read, host);
      if (opts.json)
        return writeStdoutAndExit(
          `${JSON.stringify(read.value)}\n`,
          EXIT_SUCCESS,
        );
      return writeStdoutAndExit(renderText(read.value), EXIT_SUCCESS);
    });
}
