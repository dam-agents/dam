import { Command } from "commander";
import { type ChannelConfig, ChannelType } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";

function renderHuman(channels: readonly ChannelConfig[]): string {
  return channels.length === 0
    ? "No channels connected.\n"
    : renderTable([
        ["TYPE", "IDENTIFIER", "AMBIENT"],
        ...channels.map((c) =>
          c.type === ChannelType.Slack
            ? ["slack", c.slackChannelId, c.ambient ? "on" : "off"]
            : ["telegram", "—", "—"],
        ),
      ]);
}

export function buildListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
}): Command {
  return new Command("list")
    .description("List an Agent's connected channels")
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { channels } as JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam channel list my-agent\n" +
        "  dam channel list my-agent --json\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);

      const agent = await resolveAgentOrExit(
        deps.createAgentService(host),
        ref,
        host,
      );

      const { channels } = agent;

      if (opts.json) {
        return writeStdoutAndExit(
          `${JSON.stringify({ channels })}\n`,
          EXIT_SUCCESS,
        );
      }
      return writeStdoutAndExit(renderHuman(channels), EXIT_SUCCESS);
    });
}
