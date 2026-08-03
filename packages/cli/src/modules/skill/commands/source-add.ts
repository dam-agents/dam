import { isCancel, text } from "@clack/prompts";
import { Command } from "commander";
import { skillCreateSourceInputSchema } from "api-server-api";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { exitCancelled } from "../../shared/prompt.js";
import { deriveSourceName } from "../domain/source-name.js";
import type { SkillsService } from "../services/skills-service.js";

export function buildSourceAddCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createSkillsService: (host: string) => SkillsService;
}): Command {
  return new Command("add")
    .description("Register a skill source from a git URL")
    .argument("<git-url>", "git URL of the skill source repository")
    .option("--name <name>", "source name (default: derived from the git URL)")
    .option(
      "--path <path>",
      "optional subdirectory within the repository to scan for skills",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the created SkillSource as JSON")
    .addHelpText(
      "after",
      "\nThe name defaults to the URL path (github.com/acme/skills → acme/skills);\n" +
        "pass --name to override. Adding a URL that a Platform or Agent source already\n" +
        "uses shadows it — removing your source re-exposes the original.\n" +
        "\nExamples:\n" +
        "  dam skill source add https://github.com/anthropics/skills\n" +
        "  dam skill source add https://github.com/acme/skills --name acme\n" +
        "  dam skill source add https://github.com/acme/monorepo --path .claude/skills\n",
    )
    .action(
      async (
        gitUrl: string,
        opts: { name?: string; path?: string; server?: string; json?: boolean },
      ) => {
        const json = opts.json ?? false;

        try {
          new URL(gitUrl);
        } catch {
          process.stderr.write(`error: '${gitUrl}' is not a valid URL\n`);
          process.exit(EXIT_INVALID_INPUT);
        }

        const name = await resolveName(gitUrl, opts.name, json);
        const nameCheck =
          skillCreateSourceInputSchema.shape.name.safeParse(name);
        if (!nameCheck.success) {
          const msg = nameCheck.error.issues[0]?.message ?? "invalid name";
          process.stderr.write(`error: ${msg}\n`);
          process.exit(EXIT_INVALID_INPUT);
        }

        let path: string | undefined;
        if (opts.path !== undefined) {
          const pathCheck = skillCreateSourceInputSchema.shape.path.safeParse(
            opts.path,
          );
          if (!pathCheck.success) {
            const msg = pathCheck.error.issues[0]?.message ?? "invalid path";
            process.stderr.write(`error: ${msg}\n`);
            process.exit(EXIT_INVALID_INPUT);
          }
          path = pathCheck.data || undefined;
        }

        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        const result = await deps
          .createSkillsService(host)
          .addSource({ name, gitUrl, path });
        if (!result.ok) {
          if (result.error.kind === "source-exists") {
            process.stderr.write(
              "error: a skill source for this git URL is already registered; see `dam skill source list`\n",
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          printServiceError(result.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (json) {
          process.stdout.write(`${JSON.stringify(result.value)}\n`);
        } else {
          process.stdout.write(
            `✓ Added skill source "${result.value.name}" (${result.value.id}).\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}

async function resolveName(
  gitUrl: string,
  flag: string | undefined,
  json: boolean,
): Promise<string> {
  if (flag !== undefined) return flag.trim();
  const derived = deriveSourceName(gitUrl);
  if (!process.stdin.isTTY) {
    if (!derived) {
      process.stderr.write(
        "error: couldn't derive a name from the URL — pass --name\n",
      );
      process.exit(EXIT_INVALID_INPUT);
    }
    return derived;
  }
  const answer = await text({
    message: "Source name",
    initialValue: derived,
    placeholder: derived || "owner/repo",
    validate: (v) => (v && v.trim().length > 0 ? undefined : "Required"),
  });
  if (isCancel(answer)) exitCancelled({ json });
  return String(answer).trim();
}
