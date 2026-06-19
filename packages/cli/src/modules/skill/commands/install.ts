import { Command } from "commander";
import type { AgentService } from "../../agent/index.js";
import { createAgentResolver } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import { printServiceError } from "../../shared/trpc/print.js";
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

export function buildInstallCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createSkillsService: (host: string) => SkillsService;
}): Command {
  return new Command("install")
    .description("Install (or update) a skill from a source onto an Agent")
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option("--source <id-or-url>", "source id or git URL to install from")
    .option("--name <skill>", "name of the skill to install")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the updated installed refs as JSON")
    .addHelpText(
      "after",
      "\nAlways installs the source's current HEAD — there is no --version flag\n" +
        "and no separate `update` verb. Re-running install rebakes the skill to\n" +
        'the latest HEAD (the web UI\'s "Update" button is the same operation).\n' +
        "\nExamples:\n" +
        "  dam skill install my-agent --source skl-src-abc123 --name docx\n" +
        "  dam skill install my-agent --source https://github.com/acme/skills --name docx\n",
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

        // Pass the agentId so template sources resolve too.
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

        // Scan first — install needs the HEAD version/contentHash the UI passes
        // through (there is no --version flag).
        const catalogRes = await svc.catalog(source.id, agentId);
        if (!catalogRes.ok) {
          const e = catalogRes.error;
          switch (e.kind) {
            case "agent-not-reachable":
              process.stderr.write(`error: ${e.reason}\n`);
              process.exit(EXIT_AGENT_NOT_REACHABLE);
            case "source-needs-connection":
              process.stderr.write(`error: ${e.message}\n`);
              if (e.cta)
                process.stderr.write(`hint: connect the source — ${e.cta}\n`);
              process.exit(EXIT_INVALID_INPUT);
            case "private-source-needs-agent":
              // Unreachable: install always sends an agentId. Kept for
              // exhaustiveness over the catalog error union.
              process.stderr.write(
                `error: source '${source.name}' could not be scanned\n`,
              );
              process.exit(EXIT_RUNTIME_FAILURE);
            default:
              printServiceError(e, host);
              process.exit(EXIT_RUNTIME_FAILURE);
          }
        }

        const scanned = catalogRes.value.find((s) => s.name === name);
        if (!scanned) {
          process.stderr.write(
            `error: no skill named '${name}' in source '${source.name}'\n`,
          );
          process.stderr.write(
            `hint: run \`dam skill catalog ${opts.source} --agent ${ref}\` to list available skills\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const installRes = await svc.install({
          agentId,
          source: source.gitUrl,
          name,
          version: scanned.version,
          contentHash: scanned.contentHash,
        });
        if (!installRes.ok) {
          if (installRes.error.kind === "agent-not-reachable") {
            process.stderr.write(`error: ${installRes.error.reason}\n`);
            process.exit(EXIT_AGENT_NOT_REACHABLE);
          }
          printServiceError(installRes.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(installRes.value)}\n`);
        } else {
          process.stdout.write(
            `✓ Installed "${name}" from ${source.name} at ${scanned.version.slice(0, 7)}. Agent has ${installRes.value.length} skill(s).\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
