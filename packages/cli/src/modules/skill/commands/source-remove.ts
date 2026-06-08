import { Command } from "commander";
import { printServiceError } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { confirm, exitCancelled } from "../../shared/prompt.js";
import { resolveSourceRef, sourceKind } from "../domain/source-ref.js";
import type { SkillsService } from "../services/skills-service.js";

export function buildSourceRemoveCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createSkillsService: (host: string) => SkillsService;
}): Command {
  return new Command("remove")
    .description("Remove a skill source (installed skills remain)")
    .argument("<source>", "source id or git URL (from `dam skill source list`)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("-y, --yes", "skip the confirmation prompt")
    .option(
      "--json",
      "emit { removed, id, name } or { cancelled: true } as JSON",
    )
    .addHelpText(
      "after",
      "\nRemoving a source untracks its skills across all your agents; the skill\n" +
        "files stay installed on the pods (they become standalone). Platform and\n" +
        "Agent sources can't be removed.\n" +
        "\nExamples:\n" +
        "  dam skill source remove skill-src-abc123\n" +
        "  dam skill source remove https://github.com/acme/skills --yes\n",
    )
    .action(
      async (
        ref: string,
        opts: { server?: string; yes?: boolean; json?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        const svc = deps.createSkillsService(host);
        const sources = await svc.listSources();
        if (!sources.ok) {
          printServiceError(sources.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        const source = resolveSourceRef(sources.value, ref);
        if (!source) {
          process.stderr.write(
            `error: no registered skill source with id or url '${ref}'\n`,
          );
          process.stderr.write(
            "hint: run `dam skill source list` to see registered sources\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const kind = sourceKind(source);
        if (kind !== "User") {
          const why =
            kind === "Platform"
              ? `"${source.name}" is a Platform source (managed by the cluster admin) and can't be removed.`
              : `"${source.name}" is an Agent source declared by template '${source.fromTemplate?.templateName}' and can't be removed.`;
          process.stderr.write(`error: ${why}\n`);
          process.exit(EXIT_INVALID_INPUT);
        }

        if (!opts.yes) {
          if (!process.stdin.isTTY) {
            process.stderr.write(
              "error: remove requires confirmation; pass `--yes` or run interactively\n",
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          const proceed = await confirm(
            `Remove skill source "${source.name}" (${source.id})? Its skills will be untracked on all your agents, but the files stay installed.`,
          );
          if (!proceed) exitCancelled({ json: opts.json });
        }

        const result = await svc.removeSource(source.id);
        if (!result.ok) {
          printServiceError(result.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ removed: true, id: source.id, name: source.name })}\n`,
          );
        } else {
          process.stdout.write(
            `✓ Removed skill source "${source.name}". Skills untracked across your agents; files remain installed.\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
