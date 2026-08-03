import { Command } from "commander";
import { ChannelType } from "api-server-api";
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
import type { ChannelService } from "../services/channel-service.js";
import { ensureProviderAvailable } from "./precheck.js";

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
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the updated ChannelConfig[] as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam channel slack connect my-agent --channel-id C0123ABCD\n" +
        "  dam channel slack connect my-agent --channel-id C0123ABCD --ambient\n",
    )
    .action(
      async (
        ref: string,
        opts: {
          channelId: string;
          ambient?: boolean;
          server?: string;
          json?: boolean;
        },
      ) => {
        // Reject a blank/whitespace channel id before any network call — the
        // server's min(1) accepts whitespace and a blank value is meaningless.
        const channelId = opts.channelId.trim();
        if (channelId.length === 0) {
          process.stderr.write("error: --channel-id must not be empty\n");
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

        const svc = deps.createChannelService(host);
        await ensureProviderAvailable(svc, ChannelType.Slack, host);

        const res = await svc.connectSlack(
          resolved.value.id,
          channelId,
          opts.ambient,
        );
        if (!res.ok) {
          if (res.error.kind === "channel-conflict") {
            process.stderr.write(
              "error: Slack channel already bound to another agent\n",
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          if (
            res.error.kind === "channel-precondition" ||
            res.error.kind === "invalid-input"
          ) {
            process.stderr.write(`error: ${res.error.message}\n`);
            process.exit(EXIT_INVALID_INPUT);
          }
          printServiceError(res.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.ambient) {
          // An older server strips unknown input keys, so a stripped ambient
          // lands mentions-only — the safe direction (the agent listens less,
          // not more) — so keep the binding but fail loudly instead of
          // claiming ambient.
          // By channel id, not "the" Slack binding: an Agent may hold several,
          // and the first row is not necessarily the one just connected.
          const slackCh = res.value.find(
            (c) =>
              c.type === ChannelType.Slack && c.slackChannelId === channelId,
          );
          if (!slackCh?.ambient) {
            process.stderr.write(
              "error: this server does not support ambient mode — the channel is connected without it\n",
            );
            process.exit(EXIT_RUNTIME_FAILURE);
          }
        }

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(res.value)}\n`);
        } else {
          process.stdout.write(
            `✓ Slack channel ${channelId} connected to ${resolved.value.name}${
              opts.ambient ? " with ambient on" : ""
            }.\n`,
          );
          if (opts.ambient) {
            process.stderr.write(
              "note: the agent reads along in this channel and may chime in without being mentioned; the channel gets a visible notice\n",
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
