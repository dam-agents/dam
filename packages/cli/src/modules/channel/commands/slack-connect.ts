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
      "--mode <mode>",
      "access mode: 'person-scoped' (default) or 'shared'",
    )
    .option(
      "--ambient",
      "ambient mode (shared only): the agent reads along and may chime in without being mentioned",
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
        "  dam channel slack connect my-agent --channel-id C0123ABCD --mode shared\n" +
        "  dam channel slack connect my-agent --channel-id C0123ABCD --mode shared --ambient\n",
    )
    .action(
      async (
        ref: string,
        opts: {
          channelId: string;
          mode?: string;
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
        if (
          opts.mode !== undefined &&
          opts.mode !== "shared" &&
          opts.mode !== "person-scoped"
        ) {
          process.stderr.write(
            "error: --mode must be 'shared' or 'person-scoped'\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        const mode = opts.mode as "shared" | "person-scoped" | undefined;
        if (opts.ambient && mode !== "shared") {
          process.stderr.write("error: --ambient requires --mode shared\n");
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
          mode,
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

        if (mode === "shared") {
          // An older server strips unknown input keys, silently landing the
          // bind person-scoped — verify and roll back instead of lying.
          const slackCh = res.value.find((c) => c.type === ChannelType.Slack);
          if (!slackCh || slackCh.mode !== "shared") {
            const rolledBack = await svc.disconnectSlack(resolved.value.id);
            if (rolledBack.ok) {
              process.stderr.write(
                "error: this server does not support shared access mode — binding rolled back\n",
              );
            } else {
              // The bind landed person-scoped and the rollback disconnect
              // failed too — the channel is still bound; say so rather than
              // claim a clean rollback that did not happen.
              process.stderr.write(
                "error: this server does not support shared access mode, and rolling the binding back failed — the channel is still bound in person-scoped mode; disconnect it manually\n",
              );
              printServiceError(rolledBack.error, host);
            }
            process.exit(EXIT_RUNTIME_FAILURE);
          }
        }

        if (opts.ambient) {
          // Same older-server hazard for the ambient key, checked after the
          // mode guard above so a stripped mode rolls back first. A stripped
          // ambient lands mentions-only — the safe direction (the agent
          // listens less, not more) — so keep the binding but fail loudly
          // instead of claiming ambient.
          const slackCh = res.value.find((c) => c.type === ChannelType.Slack);
          if (slackCh?.type === ChannelType.Slack && !slackCh.ambient) {
            process.stderr.write(
              "error: this server does not support ambient mode — the channel is connected in shared mode without it\n",
            );
            process.exit(EXIT_RUNTIME_FAILURE);
          }
        }

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(res.value)}\n`);
        } else {
          process.stdout.write(
            `✓ Slack channel ${channelId} connected to ${resolved.value.name}${
              mode === "shared"
                ? opts.ambient
                  ? " in shared mode with ambient on"
                  : " in shared mode"
                : ""
            }.\n`,
          );
          if (opts.ambient) {
            process.stderr.write(
              "note: the agent reads along in this channel and may chime in without being mentioned; the channel gets a visible notice\n",
            );
          }
          if (mode === "shared") {
            process.stderr.write(
              "note: everyone in the channel drives this agent under its credentials; your Terms-of-Use acceptance covers every turn\n",
            );
          } else {
            process.stderr.write(
              "hint: users must run `/platform login` inside Slack before they can drive this agent\n",
            );
          }
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}
