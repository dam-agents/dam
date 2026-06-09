import { isCancel, text } from "@clack/prompts";
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
import { exitCancelled } from "../../shared/prompt.js";
import { resolveSourceRef } from "../domain/source-ref.js";
import type { SkillsService } from "../services/skills-service.js";

export function buildPublishCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createSkillsService: (host: string) => SkillsService;
}): Command {
  return new Command("publish")
    .description(
      "Open a GitHub pull request for a standalone (locally-authored) skill",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option("--name <skill>", "name of the standalone skill to publish")
    .option(
      "--source <id-or-url>",
      "target GitHub source id or git URL to PR against",
    )
    .option("--title <title>", 'PR title (default: "Add <name> skill")')
    .option("--body <body>", "PR body (default: a brand blurb)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { prUrl, branch } as JSON")
    .addHelpText(
      "after",
      "\nPublishes a standalone (locally-authored) skill — one that lives on the\n" +
        "Agent's pod but isn't installed from a source (the ones `dam skill list`\n" +
        "shows under Standalone). --source is the target GitHub repo to PR against\n" +
        "(resolved id|url), distinct from where a skill was installed from. Only\n" +
        "GitHub sources can publish.\n" +
        "\nExamples:\n" +
        "  dam skill publish my-agent --name demo --source skl-src-abc123\n" +
        '  dam skill publish my-agent --name demo --source https://github.com/acme/skills --title "Add demo" --body "…"\n',
    )
    .action(
      async (
        ref: string,
        opts: {
          name?: string;
          source?: string;
          title?: string;
          body?: string;
          server?: string;
          json?: boolean;
        },
      ) => {
        const json = opts.json ?? false;

        if (opts.name === undefined || opts.source === undefined) {
          process.stderr.write(
            "error: both --name <skill> and --source <id|url> are required\n",
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

        // GitHub guard, up front: reject a non-publishable target before any
        // publish call (no pod wake). canPublish === "the gitUrl is GitHub".
        if (source.canPublish !== true) {
          process.stderr.write(
            `error: publishing to ${source.gitUrl} isn't supported — only GitHub sources can publish\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const { title, body } = await resolveTitleBody(name, opts, json);

        const res = await svc.publish({
          agentId,
          sourceId: source.id,
          name,
          title,
          body,
        });
        if (!res.ok) {
          const e = res.error;
          switch (e.kind) {
            case "publish-needs-connection":
              if (json) {
                process.stdout.write(
                  `${JSON.stringify({ error: e.message, fix: e.cta })}\n`,
                );
              } else {
                process.stderr.write(`error: ${e.message}\n`);
                if (e.cta) process.stderr.write(`Fix: ${e.cta}\n`);
              }
              process.exit(EXIT_INVALID_INPUT);
            case "agent-not-reachable":
              process.stderr.write(`error: ${e.reason}\n`);
              process.exit(EXIT_AGENT_NOT_REACHABLE);
            case "publish-failed":
              if (json) {
                process.stdout.write(
                  `${JSON.stringify({ error: e.message })}\n`,
                );
              } else {
                process.stderr.write(`error: ${e.message}\n`);
              }
              process.exit(EXIT_RUNTIME_FAILURE);
            default:
              printServiceError(e, host);
              process.exit(EXIT_RUNTIME_FAILURE);
          }
        }

        if (json) {
          process.stdout.write(`${JSON.stringify(res.value)}\n`);
        } else {
          process.stdout.write(
            `✓ Opened PR for "${name}" against ${source.name}: ${res.value.prUrl}\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}

/** Resolve PR title/body. Flags pass through (empty → undefined so the server
 *  default applies); otherwise prompt on a TTY; otherwise leave both undefined
 *  and let the server fill its defaults. The CLI is brand-blind, so a blank
 *  body is sent as undefined rather than an empty string. */
async function resolveTitleBody(
  name: string,
  opts: { title?: string; body?: string },
  json: boolean,
): Promise<{ title?: string; body?: string }> {
  if (opts.title !== undefined || opts.body !== undefined) {
    return {
      title: trimToUndefined(opts.title),
      body: trimToUndefined(opts.body),
    };
  }
  if (!process.stdin.isTTY) return {};

  const title = await text({
    message: "PR title",
    initialValue: `Add ${name} skill`,
    validate: (v) => (v && v.trim().length > 0 ? undefined : "Required"),
  });
  if (isCancel(title)) exitCancelled({ json });
  const body = await text({
    message: "PR body",
    placeholder: "(leave blank for default)",
  });
  if (isCancel(body)) exitCancelled({ json });

  return { title: String(title).trim(), body: trimToUndefined(String(body)) };
}

function trimToUndefined(v: string | undefined): string | undefined {
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}
