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

export function buildGrantCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("grant")
    .description("Grant one or more connections to an Agent")
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--connection <id>",
      "connection id to grant (repeatable)",
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
        "  dam connection grant my-agent --connection github\n" +
        "  dam connection grant my-agent --connection github --connection spotify\n",
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

        const svc = deps.createConnectionService(host);

        // Reject unknown ids up front — a dead grant the server can't turn
        // into an egress rule would otherwise be stored silently.
        const allRes = await svc.list();
        if (!allRes.ok) {
          printServiceError(allRes.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        const known = new Set(allRes.value.map((c) => c.id));
        const unknown = requested.filter((id) => !known.has(id));
        if (unknown.length > 0) {
          process.stderr.write(
            `error: unknown connection id(s): ${unknown.join(", ")}\n`,
          );
          process.stderr.write(
            "hint: run `dam connection list` to see valid ids\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const res = await svc.grant(resolved.value.id, requested);
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
            `✓ Granted to ${resolved.value.name}. Agent now has ${res.value.length} connection(s).\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
