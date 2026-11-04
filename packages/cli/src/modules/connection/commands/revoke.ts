import { Command } from "commander";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import {
  CONNECTION_ID_PREFIX,
  resolveConnectionRef,
} from "../domain/connection-ref.js";
import {
  resolveAgentConnections,
  type ConnectionCommandDeps,
} from "./resolve-agent-connections.js";

const collect = (v: string, acc: string[]): string[] => [...acc, v];

export function buildRevokeCommand(deps: ConnectionCommandDeps): Command {
  return new Command("revoke")
    .description(
      "Revoke one or more connections from an Agent. Idempotent — revoking an ungranted id exits 0.",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--connection <id-or-name>",
      "connection id or unique name to revoke (repeatable)",
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
          process.stderr.write(
            "error: pass at least one --connection <id-or-name>\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const { host, agent, svc, connections } = await resolveAgentConnections(
          deps,
          ref,
          opts.server,
        );
        const connectionIds: string[] = [];
        const unknown: string[] = [];
        for (const r of requested) {
          const match = resolveConnectionRef(connections, r);
          if (match) connectionIds.push(match.id);
          else if (r.startsWith(CONNECTION_ID_PREFIX)) connectionIds.push(r);
          else unknown.push(r);
        }
        if (unknown.length > 0) {
          process.stderr.write(
            `error: unknown connection name: ${unknown.join(", ")}\n`,
          );
          process.stderr.write(
            "hint: run `dam connection list` to see ids and names\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const res = await svc.revoke(agent.id, connectionIds);
        exitOnServiceError(res, host);

        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ ok: true, agentId: agent.id, connectionIds: res.value })}\n`,
          );
        } else {
          process.stdout.write(
            `✓ Revoked connection(s) from ${agent.name}. Agent now has ${res.value.length}.\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
