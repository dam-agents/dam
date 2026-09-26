import { Command } from "commander";
import { ChannelType } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { ChannelService } from "../services/channel-service.js";

export function buildSlackDisconnectCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createChannelService: (host: string) => ChannelService;
}): Command {
  return new Command("disconnect")
    .description(
      "Unbind a Slack channel from an Agent. Idempotent — a not-connected agent exits 0.",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--channel-id <id>",
      "Slack channel id to disconnect; required when the Agent has more than one connected",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the updated ChannelConfig[] as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam channel slack disconnect my-agent\n" +
        "  dam channel slack disconnect my-agent --channel-id C0123ABCD\n",
    )
    .action(
      async (
        ref: string,
        opts: { channelId?: string; server?: string; json?: boolean },
      ) => {
        const channelId = opts.channelId?.trim();
        if (opts.channelId !== undefined && !channelId) {
          process.stderr.write("error: --channel-id must not be empty\n");
          process.exit(EXIT_INVALID_INPUT);
        }

        const host = await resolveActiveHost(deps, opts.server);

        const agent = await resolveAgentOrExit(
          deps.createAgentService(host),
          ref,
          host,
        );

        const bound = agent.channels.filter(
          (c) => c.type === ChannelType.Slack,
        );
        if (!channelId && bound.length > 1) {
          process.stderr.write(
            `error: ${agent.name} has ${bound.length} Slack channels connected ` +
              `(${bound.map((c) => c.slackChannelId).join(", ")}) — pass --channel-id to say which one\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const svc = deps.createChannelService(host);
        const res = await svc.disconnectSlack(agent.id, channelId);
        exitOnServiceError(res, host);

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(res.value)}\n`);
        } else {
          process.stdout.write(
            channelId
              ? `✓ Slack channel ${channelId} disconnected from ${agent.name}.\n`
              : `✓ Slack disconnected from ${agent.name}.\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
