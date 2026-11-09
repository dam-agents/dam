import { Command } from "commander";
import { ChannelType } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { describeChannelError } from "../domain/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { ChannelService } from "../services/channel-service.js";

export function buildSlackConnectCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createChannelService: (host: string) => ChannelService;
}): Command {
  return new Command("connect")
    .description("Bind a Slack channel to an Agent")
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .requiredOption("--channel-id <id>", "Slack channel id (e.g. C0123ABCD)")
    .option(
      "--ambient",
      "ambient mode: the agent reads along and may chime in without being mentioned",
    )
    .option("--no-ambient", "turn ambient mode off")
    .option(
      "--history",
      "channel history: the agent may read the channel's older messages and threads",
    )
    .option("--no-history", "turn channel history off")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the updated ChannelConfig[] as JSON")
    .addHelpText(
      "after",
      "\nYour Slack account must be linked, and you and the bot must both be in the channel.\n" +
        "\nExamples:\n" +
        "  dam channel slack connect my-agent --channel-id C0123ABCD\n" +
        "  dam channel slack connect my-agent --channel-id C0123ABCD --ambient\n" +
        "  dam channel slack connect my-agent --channel-id C0123ABCD --history\n" +
        "  dam channel slack connect my-agent --channel-id C0123ABCD --no-ambient\n" +
        "\nConnecting again changes only the modes you name; a mode you leave out keeps its setting.\n" +
        "Turning channel history on for a channel already connected needs you and the bot in it.\n",
    )
    .action(
      async (
        ref: string,
        opts: {
          channelId: string;
          ambient?: boolean;
          history?: boolean;
          server?: string;
          json?: boolean;
        },
      ) => {
        const channelId = opts.channelId.trim();
        if (channelId.length === 0) {
          process.stderr.write("error: --channel-id must not be empty\n");
          process.exit(EXIT_INVALID_INPUT);
        }

        const host = await resolveActiveHost(deps, opts.server);

        const agent = await resolveAgentOrExit(
          deps.createAgentService(host),
          ref,
          host,
        );

        const svc = deps.createChannelService(host);
        const available = await svc.available();
        exitOnServiceError(available, host);
        if (!available.value[ChannelType.Slack]) {
          process.stderr.write("error: Slack app token not configured\n");
          process.exit(EXIT_INVALID_INPUT);
        }

        const res = await svc.connectSlack(agent.id, channelId, {
          ambient: opts.ambient,
          history: opts.history,
        });
        exitOnServiceError(res, host, describeChannelError);

        const slackCh = res.value.find(
          (c) => c.type === ChannelType.Slack && c.slackChannelId === channelId,
        );
        if (opts.ambient === true && !slackCh?.ambient) {
          process.stderr.write(
            "error: this server does not support ambient mode — the channel is connected without it\n",
          );
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        if (opts.history === true && !slackCh?.history) {
          process.stderr.write(
            "error: this server does not support channel history — the channel is connected without it\n",
          );
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        const modes = [
          ...(opts.ambient !== undefined
            ? [`ambient ${opts.ambient ? "on" : "off"}`]
            : []),
          ...(opts.history !== undefined
            ? [`channel history ${opts.history ? "on" : "off"}`]
            : []),
        ];

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(res.value)}\n`);
        } else {
          process.stdout.write(
            `✓ Slack channel ${channelId} connected to ${agent.name}${
              modes.length > 0 ? ` with ${modes.join(" and ")}` : ""
            }.\n`,
          );
          if (opts.ambient === true) {
            process.stderr.write(
              "note: the agent reads along in this channel and may chime in without being mentioned; ambient is per agent, so others connected here are unaffected\n",
            );
          }
          if (opts.history === true) {
            process.stderr.write(
              "note: from its next session the agent can read this channel's older messages and threads; what it reads lands in its sessions, which you can see\n",
            );
          }
          process.stderr.write(
            "note: everyone in the channel drives this agent under its credentials; your Terms-of-Use acceptance covers every turn\n",
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
