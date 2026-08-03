import { Command } from "commander";
import type { SkillSource } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { createAgentResolver } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { sourceKind } from "../domain/source-ref.js";
import type { SkillsService } from "../services/skills-service.js";

const HEADER = ["ID", "NAME", "GIT URL", "PATH", "KIND"];

function tableFor(sources: readonly SkillSource[]): string {
  const sorted = [...sources].sort((a, b) => a.name.localeCompare(b.name));
  return renderTable([
    HEADER,
    ...sorted.map((s) => [s.id, s.name, s.gitUrl, s.path ?? "", sourceKind(s)]),
  ]);
}

export function buildSourceListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createSkillsService: (host: string) => SkillsService;
}): Command {
  return new Command("list")
    .description(
      "List registered skill sources (optionally including an Agent's template sources)",
    )
    .option(
      "--agent <ref>",
      "Agent Ref — also include sources declared by the Agent's template",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam skill source list\n" +
        "  dam skill source list --agent my-agent\n" +
        "  dam skill source list --json\n",
    )
    .action(
      async (opts: { agent?: string; server?: string; json?: boolean }) => {
        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        let agentId: string | undefined;
        if (opts.agent !== undefined) {
          const resolver = createAgentResolver({
            agentService: deps.createAgentService(host),
          });
          const resolved = await resolver.resolve(opts.agent);
          if (!resolved.ok) {
            printResolveError(resolved.error, host);
            process.exit(exitCodeForResolveError(resolved.error));
          }
          agentId = resolved.value.id;
        }

        const result = await deps
          .createSkillsService(host)
          .listSources(agentId);
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
            "No skill sources. Add one from the Skills panel in the web UI.\n",
          );
          process.exit(EXIT_SUCCESS);
        }
        return writeStdoutAndExit(tableFor(result.value), EXIT_SUCCESS);
      },
    );
}
