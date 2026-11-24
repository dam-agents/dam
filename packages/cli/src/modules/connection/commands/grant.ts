import { Command } from "commander";
import type { ConnectionView, GrantToolAccess } from "api-server-api";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import {
  audienceOf,
  type SharingService,
  sharedConnectionNames,
  sharingUnchecked,
  sharingWarning,
} from "../../sharing/index.js";
import { resolveConnectionRef } from "../domain/connection-ref.js";
import {
  formatToolAccess,
  writesWithoutAsking,
  writesWithoutAskingNote,
} from "../domain/grant-tool-access.js";
import type { ConnectionService } from "../services/connection-service.js";
import {
  childrenOf,
  connectFromHint,
  parentLabel,
} from "../domain/github-parent.js";
import {
  resolveAgentConnections,
  type ConnectionCommandDeps,
} from "./resolve-agent-connections.js";

const collect = (v: string, acc: string[]): string[] => [...acc, v];

export function buildGrantCommand(
  deps: ConnectionCommandDeps & {
    createSharingService: (host: string) => SharingService;
  },
): Command {
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
    .option(
      "--json",
      "emit { ok, agentId, connectionIds, grantToolAccess? } as JSON; grantToolAccess maps each MCP connection " +
        "granted here to the agent's tool access on it, { read, write, overrides }",
    )
    .addHelpText(
      "after",
      "\nA GitHub sign-in or GitHub App installation is never granted: grant one of\n" +
        "the connections made from it, which `dam connection list` shows under it.\n" +
        "\nAn MCP connection the gateway reads gives the agent its own tool access, and\n" +
        "the grant prints what the agent starts with; change it with\n" +
        "`dam connection scope <connection> --agent <agent>`.\n" +
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

        const { host, agent, svc, connections } = await resolveAgentConnections(
          deps,
          ref,
          opts.server,
        );
        const connectionIds: string[] = [];
        const unknown: string[] = [];
        const parents: ConnectionView[] = [];
        for (const r of requested) {
          const match = resolveConnectionRef(connections, r);
          if (match?.isParent) parents.push(match);
          else if (match) connectionIds.push(match.id);
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
        for (const parent of parents) {
          const children = childrenOf(connections, parent.id);
          process.stderr.write(
            `error: ${parent.name} (${parent.id}) is a ${parentLabel(parent)}, which is never granted to an agent\n` +
              (children.length > 0
                ? `hint: grant a connection made from it: ${children.map((c) => `${c.name} (${c.id})`).join(", ")}\n`
                : `hint: no connection is made from it yet; make one:\n${connectFromHint(parent)}`),
          );
        }
        if (parents.length > 0) process.exit(EXIT_INVALID_INPUT);

        const res = await svc.grant(agent.id, connectionIds);
        exitOnServiceError(res, host);

        const mcp = connections.filter(
          (c) => connectionIds.includes(c.id) && c.toolAccess !== undefined,
        );
        const access = await startingAccess(svc, agent, mcp);
        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ ok: true, agentId: agent.id, connectionIds: res.value, ...(access.size > 0 && { grantToolAccess: Object.fromEntries(access) }) })}\n`,
          );
        } else {
          process.stdout.write(
            `✓ Granted to ${agent.name}. Agent now has ${res.value.length} connection(s).\n`,
          );
          const started = mcp.flatMap((c) => {
            const granted = access.get(c.id);
            return granted ? [{ connection: c, granted }] : [];
          });
          if (started.length > 0) {
            process.stdout.write(
              `Tool access of ${agent.name}:\n` +
                started
                  .map(
                    ({ connection: c, granted }) =>
                      `  ${c.name} (${c.id}): ${formatToolAccess(granted)}\n`,
                  )
                  .join(""),
            );
            for (const { connection: c, granted } of started) {
              if (writesWithoutAsking(granted, c.toolAccess?.tools ?? null)) {
                process.stderr.write(
                  writesWithoutAskingNote(agent.name, c.name),
                );
              }
            }
            process.stderr.write(
              `hint: \`dam connection scope <connection> --agent ${agent.name}\` changes it\n`,
            );
          }
        }
        const shared = sharedConnectionNames(
          connections.filter((c) => connectionIds.includes(c.id)),
        );
        if (shared.length > 0) {
          const chats = await deps
            .createSharingService(host)
            .telegramChats(agent.id);
          if (!chats.ok)
            process.stderr.write(
              sharingUnchecked(agent.name, chats.error.reason),
            );
          const warning = sharingWarning(
            agent.name,
            audienceOf(agent, chats.ok ? chats.value : []),
            { connections: shared, satellites: [] },
          );
          if (warning) process.stderr.write(warning);
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}

async function startingAccess(
  svc: ConnectionService,
  agent: { id: string; name: string },
  mcp: readonly ConnectionView[],
): Promise<Map<string, GrantToolAccess>> {
  if (mcp.length === 0) return new Map();
  const grants = await svc.agentGrants(agent.id);
  if (!grants.ok) {
    process.stderr.write(
      `note: couldn't read the agent's tool access after the grant (${grants.error.reason}); ` +
        `see it with \`dam connection list ${agent.name}\`\n`,
    );
    return new Map();
  }
  const ids = new Set(mcp.map((c) => c.id));
  return new Map(
    grants.value.flatMap((g) =>
      g.toolAccess && ids.has(g.connectionId)
        ? [[g.connectionId, g.toolAccess] as const]
        : [],
    ),
  );
}
