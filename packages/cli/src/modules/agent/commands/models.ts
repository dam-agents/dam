import { Command } from "commander";
import type {
  CatalogProviderView,
  HarnessCatalogView,
} from "agent-runtime-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentService } from "../services/agent-service.js";
import type { AgentModelsService } from "../services/agent-models-service.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { renderTable } from "../../shared/render-table.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { withQualifiedNames } from "../domain/agent-models.js";
import { resolveAgentOrExit } from "./errors.js";

const STATUS_NOTE: Record<CatalogProviderView["status"], string> = {
  listed: "",
  unavailable: "has not listed its models yet; try again in a minute",
  unsupported: "does not run this harness",
};

function renderCatalog(catalog: HarnessCatalogView): string {
  const rows = catalog.providers.flatMap((p) =>
    p.models.map((m) => [
      m.name,
      p.displayName,
      m.contextWindow === null ? "" : String(m.contextWindow),
    ]),
  );
  const notes = catalog.providers
    .filter((p) => p.status !== "listed")
    .map((p) => `note: ${p.displayName} ${STATUS_NOTE[p.status]}\n`);
  if (catalog.providers.length === 0)
    return "no model provider is granted to this agent; grant one with `dam agent update <agent> --provider <connection>`\n";
  return (
    (rows.length > 0
      ? renderTable([["MODEL", "PROVIDER", "CONTEXT"], ...rows])
      : "no models listed\n") + notes.join("")
  );
}

export function buildModelsCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createAgentModelsService: (host: string) => AgentModelsService;
}): Command {
  return new Command("models")
    .description(
      "List the models an Agent's providers offer on a harness, named as --model takes them",
    )
    .argument("<ref>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--harness <name>",
      "the harness to list models for (default: the agent's default harness)",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the harness's model catalog as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam agent models my-agent\n" +
        "  dam agent models my-agent --harness codex --json\n",
    )
    .action(
      async (
        ref: string,
        opts: { harness?: string; server?: string; json?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, opts.server);
        const agent = await resolveAgentOrExit(
          deps.createAgentService(host),
          ref,
          host,
        );
        const svc = deps.createAgentModelsService(host);

        let harness = opts.harness;
        if (harness === undefined) {
          const status = await svc.status(agent.id);
          exitOnServiceError(status, host);
          harness = status.value.defaultHarness ?? undefined;
        }
        if (harness === undefined) {
          process.stderr.write(
            "error: the agent has not reported its harnesses yet; pass --harness, or wake it (`dam agent restart`) and try again\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const catalog = await svc.catalog(agent.id, harness);
        exitOnServiceError(catalog, host);
        const named = withQualifiedNames(catalog.value);
        process.stdout.write(
          opts.json ? `${JSON.stringify(named)}\n` : renderCatalog(named),
        );
        process.exit(EXIT_SUCCESS);
      },
    );
}
