import { Command } from "commander";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { resolveConnectionRef } from "../domain/connection-ref.js";
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
      "--connection <id-or-name>",
      "connection id or unique name to grant (repeatable)",
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
          process.stderr.write(
            "error: pass at least one --connection <id-or-name>\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const host = await resolveActiveHost(deps, opts.server);

        const agent = await resolveAgentOrExit(
          deps.createAgentService(host),
          ref,
          host,
        );

        const svc = deps.createConnectionService(host);

        const allRes = await svc.list();
        exitOnServiceError(allRes, host);
        const connectionIds: string[] = [];
        const unknown: string[] = [];
        for (const r of requested) {
          const match = resolveConnectionRef(allRes.value, r);
          if (match) connectionIds.push(match.id);
          else unknown.push(r);
        }
        if (unknown.length > 0) {
          process.stderr.write(
            `error: unknown connection id or name: ${unknown.join(", ")}\n`,
          );
          process.stderr.write(
            "hint: run `dam connection list` to see ids and names\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const res = await svc.grant(agent.id, connectionIds);
        exitOnServiceError(res, host);

        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ ok: true, agentId: agent.id, connectionIds: res.value })}\n`,
          );
        } else {
          process.stdout.write(
            `✓ Granted to ${agent.name}. Agent now has ${res.value.length} connection(s).\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
