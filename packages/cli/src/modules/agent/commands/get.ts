import { Command } from "commander";
import type { ChannelConfig } from "api-server-api";
import { ChannelType } from "api-server-api";
import type { AgentView } from "../domain/agent-view.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentService } from "../services/agent-service.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { resolveAgentOrExit } from "./errors.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";

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
      "\nExamples:\n  dam agent get my-agent\n  dam agent get agent-3f9c2b7e41d08a65 --json\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);

      const svc = deps.createAgentService(host);
      const agent = await resolveAgentOrExit(svc, ref, host);

      if (opts.json) {
        return writeStdoutAndExit(`${JSON.stringify(agent)}\n`, EXIT_SUCCESS);
      }

      return writeStdoutAndExit(renderAgent(agent), EXIT_SUCCESS);
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
