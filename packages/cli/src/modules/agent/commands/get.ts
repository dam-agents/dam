import { Command } from "commander";
import type { ChannelConfig } from "api-server-api";
import { ChannelType } from "api-server-api";
import type { AgentView } from "../domain/agent-view.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentService } from "../services/agent-service.js";
import { createAgentResolver } from "../services/agent-resolver.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { exitCodeForResolveError, printResolveError } from "./errors.js";
import {
  EXIT_AGENT_BELOW_FLOOR,
  EXIT_AGENT_RUNTIME_FAILURE,
  EXIT_AGENT_SUCCESS,
} from "./exit-codes.js";

export function buildGetCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
}): Command {
  return new Command("get")
    .description("Show one Agent's details, addressed by name or ID")
    .argument("<ref>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default vertical layout")
    .addHelpText(
      "after",
      "\nExamples:\n  dam agent get my-agent\n  dam agent get agent-abc123 --json\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_AGENT_RUNTIME_FAILURE,
          belowFloor: EXIT_AGENT_BELOW_FLOOR,
        },
      });

      const svc = deps.createAgentService(host);
      const resolver = createAgentResolver({ agentService: svc });
      const result = await resolver.resolve(ref);
      if (!result.ok) {
        printResolveError(result.error, host);
        process.exit(exitCodeForResolveError(result.error));
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.value)}\n`);
        process.exit(EXIT_AGENT_SUCCESS);
      }

      process.stdout.write(renderAgent(result.value));
      process.exit(EXIT_AGENT_SUCCESS);
    });
}

function renderAgent(agent: AgentView): string {
  const entries: [string, string][] = [
    ["NAME", agent.name],
    ["ID", agent.id],
    ["TEMPLATE", agent.templateId ?? "<custom>"],
    ["IMAGE", agent.image],
    ["STATE", agent.state],
  ];
  if (agent.description) entries.push(["DESCRIPTION", agent.description]);
  entries.push(["CHANNELS", renderChannels(agent.channels)]);
  entries.push([
    "ALLOWED",
    agent.allowedUserEmails.length === 0
      ? "<none>"
      : agent.allowedUserEmails.join(", "),
  ]);
  if (agent.state === "error" && agent.error)
    entries.push(["ERROR", agent.error]);
  const pad = Math.max(...entries.map(([k]) => k.length)) + 2;
  return (
    entries
      .map(([k, v]) => `${k}:${" ".repeat(pad - k.length)}${v}`)
      .join("\n") + "\n"
  );
}

function renderChannels(channels: readonly ChannelConfig[]): string {
  if (channels.length === 0) return "<none>";
  return channels
    .map((c) => {
      if (c.type === ChannelType.Slack) return `slack(${c.slackChannelId})`;
      return "telegram";
    })
    .join(", ");
}
