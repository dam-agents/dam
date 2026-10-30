import { Command } from "commander";
import { preferenceGroupOf } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { resolveConnectionRef } from "../domain/connection-ref.js";
import type { ConnectionService } from "../services/connection-service.js";

export function buildDefaultCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("default")
    .description(
      "Set which of an Agent's accounts on one host it acts as by default",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .requiredOption(
      "--connection <id-or-name>",
      "granted connection id or unique name the agent acts as by default",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, agentId, connectionId } as JSON")
    .addHelpText(
      "after",
      "\nAn agent that holds several GitHub accounts on one host, or several Object\n" +
        "Storage connections, acts as one of them unless it switches itself: the one\n" +
        "set here, else the earliest granted. `dam connection list <agent>` marks it\n" +
        "in the DEFAULT column. The choice stays when another account is granted.\n" +
        "\nExamples:\n" +
        "  dam connection default my-agent --connection github-work\n",
    )
    .action(
      async (
        ref: string,
        opts: { connection: string; server?: string; json?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, opts.server);
        const agent = await resolveAgentOrExit(
          deps.createAgentService(host),
          ref,
          host,
        );
        const svc = deps.createConnectionService(host);

        const [allRes, grantsRes] = await Promise.all([
          svc.list(),
          svc.agentGrants(agent.id),
        ]);
        exitOnServiceError(allRes, host);
        exitOnServiceError(grantsRes, host);

        const match = resolveConnectionRef(allRes.value, opts.connection);
        if (!match) {
          process.stderr.write(
            `error: unknown connection id or name: ${opts.connection}\n` +
              "hint: run `dam connection list` to see ids and names\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        if (!grantsRes.value.some((g) => g.connectionId === match.id)) {
          process.stderr.write(
            `error: ${match.name} (${match.id}) is not granted to ${agent.name}\n` +
              `hint: grant it first: dam connection grant ${ref} --connection ${match.id}\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        if (preferenceGroupOf(match.contributions) === undefined) {
          process.stderr.write(
            `error: ${match.name} (${match.id}) is not an account the agent picks a default among; only GitHub and Object Storage connections are\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const res = await svc.setDefault(agent.id, match.id);
        exitOnServiceError(res, host);

        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ ok: true, agentId: agent.id, connectionId: match.id })}\n`,
          );
        } else {
          process.stdout.write(
            `✓ ${agent.name} acts as ${match.name} by default on ${match.hosts.join(",")}.\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
