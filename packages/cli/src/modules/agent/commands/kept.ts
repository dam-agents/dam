import { Command } from "commander";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentService } from "../services/agent-service.js";
import { resolveAgentOrExit } from "./errors.js";
import { renderTable } from "../../shared/render-table.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";

export function buildKeptCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
}): Command {
  return new Command("kept")
    .description(
      "List the sub-agents kept under an Agent, its sub-agents' too, as a tree, and until when each is kept",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nDelete one, with its files, its own Environments and its sub-agents, with `dam agent delete <id>`.\n\nExamples:\n  dam agent kept my-agent\n  dam agent kept my-agent --json\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);
      const service = deps.createAgentService(host);
      const agent = await resolveAgentOrExit(service, ref, host);
      const result = await service.kept(agent.id);
      exitOnServiceError(result, host);
      if (opts.json)
        return writeStdoutAndExit(
          `${JSON.stringify(result.value)}\n`,
          EXIT_SUCCESS,
        );
      if (result.value.length === 0) {
        process.stderr.write("No kept sub-agents.\n");
        process.exit(EXIT_SUCCESS);
      }
      return writeStdoutAndExit(
        renderTable([
          ["ID", "LABEL", "STATUS", "KEPT UNTIL"],
          ...treeOrder(result.value).map(({ kept: k, depth }) => [
            `${"  ".repeat(depth)}${k.id}`,
            k.label ?? "",
            k.status,
            k.keepUntil,
          ]),
        ]),
        EXIT_SUCCESS,
      );
    });
}

// UNIT_BOUNDARY_DESCRIPTION: the kept sub-agents in tree order, each after the one it sits under and indented one step deeper, as the app's Artifacts list shows them.
function treeOrder<T extends { id: string; parentId?: string | null }>(
  all: readonly T[],
): { kept: T; depth: number }[] {
  const out: { kept: T; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const kept of all.filter((k) => (k.parentId ?? null) === parentId)) {
      out.push({ kept, depth });
      visit(kept.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}
