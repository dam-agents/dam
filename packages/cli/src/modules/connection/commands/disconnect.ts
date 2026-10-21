import { Command } from "commander";
import type { AgentService } from "../../agent/index.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { confirm, exitCancelled } from "../../shared/prompt.js";
import { resolveConnectionRef } from "../domain/connection-ref.js";
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
    .option("--json", "emit { ok, id, name } or { cancelled: true } as JSON")
    .addHelpText(
      "after",
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
          process.stderr.write(
            `error: no connection with id or name '${ref}'\n`,
          );
          process.stderr.write(
            "hint: run `dam connection list` to see ids and names\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        if (!opts.yes) {
          const impact = grantImpact(
            await grantedAgentNames(deps, host, match.id),
          );
          if (!process.stdin.isTTY) {
            process.stderr.write(
              `error: disconnect requires confirmation; pass \`--yes\` or run interactively\n${impact}\n`,
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          const proceed = await confirm(
            `Disconnect "${match.name}" (${match.id})? This deletes its stored credential and cannot be undone. ${impact}`,
          );
          if (!proceed) exitCancelled(opts);
        }

        const result = await svc.disconnect(match.id);
        exitOnServiceError(result, host);

        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ ok: true, id: match.id, name: match.name })}\n`,
          );
        } else {
          process.stdout.write(
            `✓ Disconnected ${match.name} (${match.id}).\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}

async function grantedAgentNames(
  deps: DisconnectDeps,
  host: string,
  connectionId: string,
): Promise<string[] | undefined> {
  const agents = await deps.createAgentService(host).list();
  if (!agents.ok) return undefined;
  const svc = deps.createConnectionService(host);
  const grants = await Promise.all(
    agents.value.map(async (agent) => ({
      agent,
      ids: await svc.agentConnectionIds(agent.id),
    })),
  );
  if (grants.some((g) => !g.ids.ok)) return undefined;
  return grants
    .filter((g) => g.ids.ok && g.ids.value.includes(connectionId))
    .map((g) => g.agent.name);
}

function grantImpact(granted: readonly string[] | undefined): string {
  if (granted === undefined) {
    return "Could not read which agents it is granted to; every agent it is granted to loses it.";
  }
  if (granted.length === 0) return "It is granted to no agent.";
  return `It is granted to ${granted.length} agent(s), which lose it: ${granted.join(", ")}.`;
}
