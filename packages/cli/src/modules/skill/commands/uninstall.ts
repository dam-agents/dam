import { Command } from "commander";
import type { AgentService } from "../../agent/index.js";
import { createAgentResolver } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
  printServiceError,
} from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_AGENT_NOT_REACHABLE,
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { resolveSourceRef } from "../domain/source-ref.js";
import type { SkillsService } from "../services/skills-service.js";

export function buildUninstallCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createSkillsService: (host: string) => SkillsService;
}): Command {
  return new Command("uninstall")
    .description("Remove a skill from an Agent")
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option("--source <id-or-url>", "source id or git URL the skill came from")
    .option("--name <skill>", "name of the skill to remove")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the remaining installed refs as JSON")
    .addHelpText(
      "after",
      "\nIdempotent — removing a skill that isn't installed still exits 0.\n" +
        "\nExamples:\n" +
        "  dam skill uninstall my-agent --source skl-src-abc123 --name docx\n" +
        "  dam skill uninstall my-agent --source https://github.com/acme/skills --name docx\n",
    )
    .action(
      async (
        ref: string,
        opts: {
          source?: string;
          name?: string;
          server?: string;
          json?: boolean;
        },
      ) => {
        if (opts.source === undefined || opts.name === undefined) {
          process.stderr.write(
            "error: both --source <id|url> and --name <skill> are required\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        const name = opts.name;

        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        const resolver = createAgentResolver({
          agentService: deps.createAgentService(host),
        });
        const resolved = await resolver.resolve(ref);
        if (!resolved.ok) {
          printResolveError(resolved.error, host);
          process.exit(exitCodeForResolveError(resolved.error));
        }
        const agentId = resolved.value.id;

        const svc = deps.createSkillsService(host);

        // Need the source's gitUrl for the mutation — no scan required.
        const sourcesRes = await svc.listSources(agentId);
        if (!sourcesRes.ok) {
          printServiceError(sourcesRes.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        const source = resolveSourceRef(sourcesRes.value, opts.source);
        if (!source) {
          process.stderr.write(
            `error: no registered skill source with id or url '${opts.source}'\n`,
          );
          process.stderr.write(
            "hint: run `dam skill source list` to see registered sources\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const uninstallRes = await svc.uninstall({
          agentId,
          source: source.gitUrl,
          name,
        });
        if (!uninstallRes.ok) {
          if (uninstallRes.error.kind === "agent-not-reachable") {
            process.stderr.write(`error: ${uninstallRes.error.reason}\n`);
            process.exit(EXIT_AGENT_NOT_REACHABLE);
          }
          printServiceError(uninstallRes.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(uninstallRes.value)}\n`);
        } else {
          process.stdout.write(
            `✓ Uninstalled "${name}" from ${source.name}. Agent has ${uninstallRes.value.length} skill(s).\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
