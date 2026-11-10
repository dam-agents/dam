import { Command } from "commander";
import type { SlackDmStatusView } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { describeChannelError } from "../domain/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { ChannelService } from "../services/channel-service.js";

interface SlackDmCommandDeps {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createChannelService: (host: string) => ChannelService;
}

const REASONS: Record<string, string> = {
  "feature-off":
    "this deployment trusts no Slack workspace for email pairing, so the DM Bridge is off",
  "no-trusted-workspace":
    "no Slack workspace the operator trusts for email pairing is connected and active",
  scopes:
    "the Slack app in the trusted workspace does not grant the permissions the DM Bridge needs",
  email: "your account has no verified email address in Keycloak",
  "no-match":
    "no Slack account in a trusted workspace has your verified email address",
};

function describeStatus(status: SlackDmStatusView): string {
  switch (status.state) {
    case "off":
      return `DM Bridge: off — ${REASONS[status.reason ?? ""] ?? status.reason ?? "not configured"}.\n`;
    case "linked":
      return `DM Bridge: ready — your Slack account ${status.slackUserId} in workspace ${status.teamId} is linked.\n`;
    case "pairable":
      return `DM Bridge: pairable — your Slack account ${status.slackUserId} in workspace ${status.teamId} matches your verified email.\n`;
    case "unavailable":
      return `DM Bridge: unavailable — ${REASONS[status.reason ?? ""] ?? status.reason ?? "unknown reason"}.\n`;
  }
}

export function buildSlackDmStatusCommand(deps: SlackDmCommandDeps): Command {
  return new Command("status")
    .description(
      "Report whether the DM Bridge can pair your Slack account. Read-only: it sends nothing and binds nothing.",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the status as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n  dam channel slack-dm status\n  dam channel slack-dm status --json\n",
    )
    .action(async (opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);
      const svc = deps.createChannelService(host);
      const res = await svc.slackDmStatus();
      exitOnServiceError(res, host);
      process.stdout.write(
        opts.json
          ? `${JSON.stringify(res.value)}\n`
          : describeStatus(res.value),
      );
      process.exit(EXIT_SUCCESS);
    });
}

export function buildSlackDmConnectCommand(deps: SlackDmCommandDeps): Command {
  return new Command("connect")
    .description(
      "Bind an Agent to your 1:1 Slack DM with the bot, pairing your Slack account by verified email when it is not linked yet.",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--purpose <text>",
      "what the agent sends you there, as the hello names it (default: your results)",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the result as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam channel slack-dm connect my-assistant\n" +
        '  dam channel slack-dm connect my-assistant --purpose "your Friday draft"\n' +
        "\nThe deployment must trust your Slack workspace for email pairing, and your\n" +
        "account needs a verified email address there. A Slack account already linked\n" +
        "to another DAM account is refused and left alone.\n" +
        "Messages in the DM can ask the agent to act on your DAM account, and\n" +
        "`/<brand> unbind` from that DM undoes the connect.\n",
    )
    .action(
      async (
        ref: string,
        opts: { purpose?: string; server?: string; json?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, opts.server);
        const agent = await resolveAgentOrExit(
          deps.createAgentService(host),
          ref,
          host,
        );
        const svc = deps.createChannelService(host);
        const res = await svc.slackDmConnect(agent.id, opts.purpose);
        exitOnServiceError(res, host, describeChannelError);

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(res.value)}\n`);
        } else {
          const done = res.value;
          process.stdout.write(
            done.binding === "existing"
              ? `✓ ${agent.name} is already in your Slack DM (${done.dmChannelId}); nothing changed and nothing was posted.\n`
              : `✓ ${agent.name} is in your Slack DM (${done.dmChannelId})${done.helloPosted ? "" : " — the hello could not be posted"}.\n`,
          );
          if (!done.isDefault && done.binding === "created") {
            process.stderr.write(
              `note: your DM already had a default agent, so start a message with ${agent.name} to reach it\n`,
            );
          }
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}

export function buildSlackDmDisconnectCommand(
  deps: SlackDmCommandDeps,
): Command {
  return new Command("disconnect")
    .description(
      "Release an Agent from your 1:1 Slack DM with the bot, its threads and the email pairing it made.",
    )
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the result as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n  dam channel slack-dm disconnect my-assistant\n" +
        "\nA Slack account you linked with `/<brand> login` keeps its link; only an\n" +
        "email pairing is removed, and only when nothing else is bound in that DM.\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);
      const agent = await resolveAgentOrExit(
        deps.createAgentService(host),
        ref,
        host,
      );
      const svc = deps.createChannelService(host);
      const res = await svc.slackDmDisconnect(agent.id);
      exitOnServiceError(res, host);

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(res.value)}\n`);
      } else {
        process.stdout.write(
          res.value.disconnected === 0
            ? `✓ ${agent.name} was not in your Slack DM; nothing changed.\n`
            : `✓ ${agent.name} released from your Slack DM (${res.value.threadsReleased} thread(s) released${
                res.value.linksRemoved > 0 ? ", email pairing removed" : ""
              }).\n`,
        );
      }
      process.exit(EXIT_SUCCESS);
    });
}
