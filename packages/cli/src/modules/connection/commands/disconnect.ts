import { Command } from "commander";
import type { ConnectionView } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { confirm, exitCancelled } from "../../shared/prompt.js";
import {
  resolveConnectionRef,
  unresolvedConnectionRef,
} from "../domain/connection-ref.js";
import { childrenOf, parentLabel, parentOf } from "../domain/github-parent.js";
import type { ConnectionService } from "../services/connection-service.js";

type DisconnectDeps = {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createConnectionService: (host: string) => ConnectionService;
};

export function buildDisconnectCommand(deps: DisconnectDeps): Command {
  return new Command("disconnect")
    .description("Remove a team connection (deletes the stored credential)")
    .argument(
      "<id-or-name>",
      "Connection id ('conn-…') or unique name (from `dam connection list`)",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("-y, --yes", "skip the confirmation prompt")
    .option(
      "--json",
      "emit { ok, id, name, connections? } or { cancelled: true } as JSON; " +
        "connections lists the ones removed with a GitHub sign-in or installation",
    )
    .addHelpText(
      "after",
      "\nRemoving a GitHub sign-in or GitHub App installation removes every connection\n" +
        "made from it too, and the agents they are granted to lose them; the prompt\n" +
        "names each. A name that a sign-in and a connection share means the connection:\n" +
        "pass the sign-in's id to remove the sign-in.\n" +
        "\nExamples:\n" +
        "  dam connection disconnect conn-61cc7b9137b0\n" +
        "  dam connection disconnect my-mcp-server --yes\n",
    )
    .action(
      async (
        ref: string,
        opts: { server?: string; yes?: boolean; json?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, opts.server);

        const svc = deps.createConnectionService(host);

        const listed = await svc.list();
        exitOnServiceError(listed, host);
        const match = resolveConnectionRef(listed.value, ref);
        if (!match) {
          process.stderr.write(unresolvedConnectionRef(listed.value, ref));
          process.exit(EXIT_INVALID_INPUT);
        }
        const children = match.isParent
          ? childrenOf(listed.value, match.id)
          : [];

        if (!opts.yes) {
          const grants = await agentGrants(deps, host);
          const impact = match.isParent
            ? parentImpact(match, children, grants)
            : grantImpact(holders(grants, match.id));
          if (!process.stdin.isTTY) {
            process.stderr.write(
              `error: disconnect requires confirmation; pass \`--yes\` or run interactively\n${impact}\n`,
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          const proceed = await confirm(
            match.isParent
              ? `${impact}\nDisconnect it? This deletes its stored credential and every connection made from it, and cannot be undone.`
              : `Disconnect "${match.name}" (${match.id})? This deletes its stored credential and cannot be undone. ${impact}`,
          );
          if (!proceed) exitCancelled(opts);
        }

        const result = await svc.disconnect(match.id);
        exitOnServiceError(result, host);

        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({
              ok: true,
              id: match.id,
              name: match.name,
              ...(match.isParent
                ? {
                    connections: children.map((c) => ({
                      id: c.id,
                      name: c.name,
                    })),
                  }
                : {}),
            })}\n`,
          );
        } else if (match.isParent) {
          process.stdout.write(
            `✓ Disconnected the ${parentLabel(match)} ${match.name} (${match.id})` +
              (children.length > 0
                ? ` and the ${children.length} connection(s) made from it: ${children.map((c) => c.name).join(", ")}`
                : "") +
              ".\n",
          );
        } else {
          process.stdout.write(`✓ Disconnected ${match.name} (${match.id}).\n`);
        }
        const parent = parentOf(listed.value, match);
        if (parent && !opts.json) {
          const others = childrenOf(listed.value, parent.id).length - 1;
          process.stderr.write(
            `note: the ${parentLabel(parent)} ${parent.name} (${parent.id}) it was made from stays` +
              (others > 0 ? `, with ${others} other connection(s)` : "") +
              `; remove it with \`dam connection disconnect ${parent.id}\`\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}

interface AgentGrants {
  agentName: string;
  connectionIds: readonly string[];
}

async function agentGrants(
  deps: DisconnectDeps,
  host: string,
): Promise<AgentGrants[] | undefined> {
  const agents = await deps.createAgentService(host).list();
  if (!agents.ok) return undefined;
  const svc = deps.createConnectionService(host);
  const read = await Promise.all(
    agents.value.map(async (agent) => ({
      agent,
      ids: await svc.agentConnectionIds(agent.id),
    })),
  );
  const grants: AgentGrants[] = [];
  for (const { agent, ids } of read) {
    if (!ids.ok) return undefined;
    grants.push({ agentName: agent.name, connectionIds: ids.value });
  }
  return grants;
}

function holders(
  grants: readonly AgentGrants[] | undefined,
  connectionId: string,
): string[] | undefined {
  return grants
    ?.filter((g) => g.connectionIds.includes(connectionId))
    .map((g) => g.agentName);
}

function parentImpact(
  parent: ConnectionView,
  children: readonly ConnectionView[],
  grants: readonly AgentGrants[] | undefined,
): string {
  const what = `The ${parentLabel(parent)} "${parent.name}" (${parent.id})`;
  if (children.length === 0) return `${what} has no connection made from it.`;
  const lines = children.map((c) => {
    const granted = holders(grants, c.id);
    return `  ${c.name} (${c.id}): ${
      granted === undefined
        ? "could not read which agents it is granted to; each loses it"
        : granted.length === 0
          ? "granted to no agent"
          : `granted to ${granted.length} agent(s), which lose it: ${granted.join(", ")}`
    }.`;
  });
  return [
    `${what} has ${children.length} connection(s) made from it, which go with it:`,
    ...lines,
  ].join("\n");
}

function grantImpact(granted: readonly string[] | undefined): string {
  if (granted === undefined) {
    return "Could not read which agents it is granted to; every agent it is granted to loses it.";
  }
  if (granted.length === 0) return "It is granted to no agent.";
  return `It is granted to ${granted.length} agent(s), which lose it: ${granted.join(", ")}.`;
}
