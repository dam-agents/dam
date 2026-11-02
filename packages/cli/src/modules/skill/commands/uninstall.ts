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

export function buildUninstallCommand(deps: SkillCommandDeps): Command {
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

        const { host, agentId, svc, source } = await resolveSkillTarget(
          deps,
          ref,
          opts.source,
          opts.server,
        );

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
