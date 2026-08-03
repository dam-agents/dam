import { Command } from "commander";
import type { AgentService } from "../../agent/index.js";
import { createAgentResolver } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import {
  CONNECTION_ID_PREFIX,
  resolveConnectionRef,
} from "../domain/connection-ref.js";
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

        // Resolve names to ids, but let a raw `conn-…` id pass through even if
        // it's no longer in the team list — that's how a stale grant (a
        // granted connection since deleted) gets cleaned up. Only an unknown
        // *name* is an error.
        const allRes = await svc.list();
        if (!allRes.ok) {
          printServiceError(allRes.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        const connectionIds: string[] = [];
        const unknown: string[] = [];
        for (const r of requested) {
          const match = resolveConnectionRef(allRes.value, r);
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

        const res = await svc.revoke(resolved.value.id, connectionIds);
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
