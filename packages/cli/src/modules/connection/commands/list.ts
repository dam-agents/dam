import { Command } from "commander";
import type { ConnectionView } from "api-server-api";
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
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import type { ConnectionService } from "../services/connection-service.js";

const HEADER = ["ID", "NAME", "CATEGORY", "STATUS", "HOSTS"];

function sortViews(
  views: readonly ConnectionView[],
): readonly ConnectionView[] {
  return [...views].sort((a, b) => {
    const c = a.category.localeCompare(b.category);
    if (c !== 0) return c;
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
    return a.id.localeCompare(b.id);
  });
}

function tableFor(views: readonly ConnectionView[]): string {
  return renderTable([
    HEADER,
    ...sortViews(views).map((c) => [
      c.id,
      c.name,
      c.category,
      c.status,
      c.hosts.join(","),
    ]),
  ]);
}

export function buildListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createConnectionService: (host: string) => ConnectionService;
}): Command {
  return new Command("list")
    .description(
      "List team connections, or the connections granted to one Agent",
    )
    .argument("[agent]", "Agent Ref — name or 'agent-…' ID (optional)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam connection list\n" +
        "  dam connection list my-agent\n" +
        "  dam connection list --json\n",
    )
    .action(
      async (
        ref: string | undefined,
        opts: { server?: string; json?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });
        const svc = deps.createConnectionService(host);

        if (ref === undefined) {
          const result = await svc.list();
          if (!result.ok) {
            printServiceError(result.error, host);
            process.exit(EXIT_RUNTIME_FAILURE);
          }
          if (opts.json) {
            return writeStdoutAndExit(
              `${JSON.stringify(result.value)}\n`,
              EXIT_SUCCESS,
            );
          }
          if (result.value.length === 0) {
            process.stderr.write(
              "No connections. See `dam connection templates` for options, then `dam connection connect <id>`.\n",
            );
            process.exit(EXIT_SUCCESS);
          }
          return writeStdoutAndExit(tableFor(result.value), EXIT_SUCCESS);
        }

        // Agent-scoped: resolve the ref, read its grants, intersect with the
        // team list. Granted ids absent from the team list (stale grants) are
        // surfaced on stderr rather than rendered as fabricated rows.
        const resolver = createAgentResolver({
          agentService: deps.createAgentService(host),
        });
        const resolved = await resolver.resolve(ref);
        if (!resolved.ok) {
          printResolveError(resolved.error, host);
          process.exit(exitCodeForResolveError(resolved.error));
        }

        // Independent reads — fetch the agent's grants and the team list
        // concurrently; the intersection below needs both.
        const [idsRes, allRes] = await Promise.all([
          svc.agentConnectionIds(resolved.value.id),
          svc.list(),
        ]);
        if (!idsRes.ok) {
          printServiceError(idsRes.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        if (!allRes.ok) {
          printServiceError(allRes.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        const byId = new Map(allRes.value.map((c) => [c.id, c]));
        const matched: ConnectionView[] = [];
        const missing: string[] = [];
        for (const id of idsRes.value) {
          const view = byId.get(id);
          if (view) matched.push(view);
          else missing.push(id);
        }

        if (opts.json) {
          return writeStdoutAndExit(
            `${JSON.stringify(matched)}\n`,
            EXIT_SUCCESS,
          );
        }
        if (matched.length === 0 && missing.length === 0) {
          process.stderr.write(
            `Agent ${ref} has no connections. Grant one with \`dam connection grant ${ref} --connection <id>\`.\n`,
          );
          process.exit(EXIT_SUCCESS);
        }
        if (missing.length > 0) {
          process.stderr.write(
            `note: ${missing.length} granted connection(s) no longer exist: ${missing.join(", ")}\n`,
          );
        }
        if (matched.length > 0) {
          return writeStdoutAndExit(tableFor(matched), EXIT_SUCCESS);
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
