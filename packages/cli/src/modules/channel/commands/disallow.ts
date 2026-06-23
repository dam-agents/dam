import { Command } from "commander";
import type { AgentService } from "../../agent/index.js";
import {
  createAgentResolver,
  mergeAllowedUserEmails,
} from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_AGENT_NOT_RESOLVED,
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";

const collect = (v: string, acc: string[]): string[] => [...acc, v];

export function buildDisallowCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
}): Command {
  return new Command("disallow")
    .description(
      "Remove one or more users from an Agent's allowed-user list. Idempotent.",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--user <email>",
      "user email to remove (repeatable)",
      collect,
      [] as string[],
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, agentId, allowedUserEmails } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam channel disallow my-agent --user teammate@example.com\n",
    )
    .action(
      async (
        ref: string,
        opts: { user: string[]; server?: string; json?: boolean },
      ) => {
        const users = opts.user;
        if (users.length === 0) {
          process.stderr.write("error: pass at least one --user <email>\n");
          process.exit(EXIT_INVALID_INPUT);
        }

        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        const svc = deps.createAgentService(host);
        const resolver = createAgentResolver({ agentService: svc });
        const resolved = await resolver.resolve(ref);
        if (!resolved.ok) {
          printResolveError(resolved.error, host);
          process.exit(exitCodeForResolveError(resolved.error));
        }

        // Removing by exact string match — no email validation, mirroring the
        // way `connection revoke` lets a raw id through.
        const merged = mergeAllowedUserEmails(
          resolved.value.allowedUserEmails,
          {
            remove: users,
          },
        );
        const res = await svc.updateAllowedUserEmails(
          resolved.value.id,
          merged,
        );
        if (!res.ok) {
          if (res.error.kind === "invalid-input") {
            process.stderr.write(`error: ${res.error.message}\n`);
            process.exit(EXIT_INVALID_INPUT);
          }
          if (res.error.kind === "not-found") {
            process.stderr.write(
              `error: no agent with id \`${resolved.value.id}\`\n`,
            );
            process.exit(EXIT_AGENT_NOT_RESOLVED);
          }
          printServiceError(res.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ ok: true, agentId: resolved.value.id, allowedUserEmails: res.value.allowedUserEmails })}\n`,
          );
        } else {
          process.stdout.write(
            `✓ Disallowed ${users.length} user(s) from ${resolved.value.name}. Agent now has ${res.value.allowedUserEmails.length} allowed user(s).\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
