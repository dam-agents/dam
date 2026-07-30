import { Command } from "commander";
import { type ChannelConfig, ChannelType } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { createAgentResolver } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
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

function renderHuman(channels: readonly ChannelConfig[]): string {
  return channels.length === 0
    ? "No channels connected.\n"
    : renderTable([
        ["TYPE", "IDENTIFIER", "AMBIENT"],
        ...channels.map((c) =>
          // Telegram has no readable identifier — the bot token is write-only.
          // Ambient is Slack-only.
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
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });

      // The resolver returns the full AgentView, which already carries
      // `channels` — no second read needed.
      const resolver = createAgentResolver({
        agentService: deps.createAgentService(host),
      });
      const resolved = await resolver.resolve(ref);
      if (!resolved.ok) {
        printResolveError(resolved.error, host);
        process.exit(exitCodeForResolveError(resolved.error));
      }

      const { channels } = resolved.value;

      if (opts.json) {
        return writeStdoutAndExit(
          `${JSON.stringify({ channels })}\n`,
          EXIT_SUCCESS,
        );
      }
      return writeStdoutAndExit(renderHuman(channels), EXIT_SUCCESS);
    });
}
