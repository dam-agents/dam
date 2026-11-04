import { Command } from "commander";
import { printServiceError } from "../../shared/trpc/print.js";
import {
  EXIT_AGENT_NOT_REACHABLE,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import {
  resolveSkillTarget,
  type SkillCommandDeps,
} from "./resolve-skill-target.js";

export function buildInstallCommand(deps: SkillCommandDeps): Command {
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

        const { host, agentId, svc, source } = await resolveSkillTarget(
          deps,
          ref,
          opts.source,
          opts.server,
        );

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
          ...(source.path !== undefined ? { path: source.path } : {}),
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
