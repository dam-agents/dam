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
import { resolveSourceRef } from "../domain/source-ref.js";
import type { SkillsService } from "../services/skills-service.js";

export function buildSourceRefreshCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createSkillsService: (host: string) => SkillsService;
}): Command {
  return new Command("refresh")
    .description(
      "Drop a source's scan cache so the next catalog re-scans upstream",
    )
    .argument("<source>", "source id or git URL (from `dam skill source list`)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { refreshed, id, name } as JSON")
    .addHelpText(
      "after",
      "\nDrops the upstream scan cache for a User or Platform source so the next\n" +
        "`catalog` re-scans. (Template/Agent sources aren't reachable here — scan\n" +
        "them via `catalog <source> --agent <ref>`.)\n" +
        "\nExamples:\n" +
        "  dam skill source refresh skill-src-abc123\n" +
        "  dam skill source refresh https://github.com/acme/skills\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
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

      const result = await svc.refreshSource(source.id);
      if (!result.ok) {
        if (result.error.kind === "source-not-found") {
          process.stderr.write(
            `error: skill source '${ref}' no longer exists\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify({ refreshed: true, id: source.id, name: source.name })}\n`,
        );
      } else {
        process.stdout.write(
          `✓ Refreshed scan cache for "${source.name}". The next catalog re-scans upstream.\n`,
        );
      }
      process.exit(EXIT_SUCCESS);
    });
}
