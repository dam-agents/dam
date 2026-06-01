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
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { ConnectionService } from "../services/connection-service.js";

const collect = (v: string, acc: string[]): string[] => [...acc, v];

export function buildRevokeCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("revoke")
    .description(
      "Revoke one or more connections from an Agent. Idempotent — revoking an ungranted id exits 0.",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--connection <id>",
      "connection id to revoke (repeatable)",
      collect,
      [] as string[],
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, agentId, connectionIds } as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam connection revoke my-agent --connection github\n" +
        "  dam connection revoke my-agent --connection github --connection spotify\n",
    )
    .action(
      async (
        ref: string,
        opts: { connection: string[]; server?: string; json?: boolean },
      ) => {
        const requested = opts.connection;
        if (requested.length === 0) {
          process.stderr.write("error: pass at least one --connection <id>\n");
          process.exit(EXIT_INVALID_INPUT);
        }

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

        const res = await deps
          .createConnectionService(host)
          .revoke(resolved.value.id, requested);
        if (!res.ok) {
          printServiceError(res.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ ok: true, agentId: resolved.value.id, connectionIds: res.value })}\n`,
          );
        } else {
          process.stdout.write(
            `✓ Revoked connection(s) from ${resolved.value.name}. Agent now has ${res.value.length}.\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
