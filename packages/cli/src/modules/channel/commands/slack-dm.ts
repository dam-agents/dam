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
        "to another account here is refused and left alone.\n" +
        "The DM carries questions about the results; changing what the agent does\n" +
        "stays in the app. The unbind command in that DM undoes the connect, and\n" +
        "only a later connect here reopens it — binding the DM another way leaves it\n" +
        "closed.\n",
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
          /* UNIT_BOUNDARY_DESCRIPTION: the output is what this call settled,
           * not a fixed story: a re-connect of a DM that was released can post
           * the greeting while reporting an existing binding. */
          const posted = done.helloPosted
            ? " and the hello was posted"
            : " — the hello was not posted; the next connect retries it";
          process.stdout.write(
            done.binding === "existing"
              ? `✓ ${agent.name} is already in your Slack DM (${done.dmChannelId})${done.helloPosted ? "; the hello that was missing was posted" : "; nothing changed and nothing was posted"}.\n`
              : `✓ ${agent.name} is in your Slack DM (${done.dmChannelId})${posted}.\n`,
          );
          if (done.link === "created") {
            process.stderr.write(
              "note: your Slack account is now linked to your account by your verified email; signing in to the platform replaces that with a proven link\n",
            );
          }
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
        "\nA Slack account you linked by signing in keeps its link; only an email\n" +
        "pairing is removed, and only when nothing else is bound in that DM.\n",
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
            ? `✓ ${agent.name} is not in your Slack DM; nothing changed.\n`
            : `✓ ${agent.name} released from your Slack DM (${res.value.threadsReleased} thread(s) released${
                res.value.linksRemoved > 0 ? ", email pairing removed" : ""
              }).\n`,
        );
        if (res.value.incomplete.length > 0) {
          /* UNIT_BOUNDARY_DESCRIPTION: the release is one transaction, so a
           * failure rolled it back — the binding and the DM's state are exactly
           * as they were, which may mean the agent still reaches that DM. */
          process.stderr.write(
            `warning: the release of ${res.value.incomplete.join(", ")} failed and changed nothing, ` +
              "so the agent may still reach that DM — run the disconnect again\n",
          );
        }
      }
      process.exit(EXIT_SUCCESS);
    });
}
