import { Command } from "commander";
import type { ChannelConfig } from "api-server-api";
import { ChannelType } from "api-server-api";
import { type AgentView, displayState } from "../domain/agent-view.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentService } from "../services/agent-service.js";
import {
  readAgentModels,
  type AgentModelsService,
} from "../services/agent-models-service.js";
import {
  modelEntries,
  renderEntries,
  type AgentModelsView,
} from "../domain/agent-models.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { resolveAgentOrExit } from "./errors.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";

export function buildGetCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createAgentModelsService: (host: string) => AgentModelsService;
}): Command {
  return new Command("get")
    .description("Show one Agent's details, addressed by name or ID")
    .argument("<ref>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--json",
      "emit the agent as JSON, with a `models` object: its providers, harnesses and defaults",
    )
    .addHelpText(
      "after",
      "\nExamples:\n  dam agent get my-agent\n  dam agent get agent-3f9c2b7e41d08a65 --json\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);

      const svc = deps.createAgentService(host);
      const agent = await resolveAgentOrExit(svc, ref, host);
      const models = await readAgentModels(
        deps.createAgentModelsService(host),
        agent.id,
      );

      if (opts.json) {
        return writeStdoutAndExit(
          `${JSON.stringify({ ...agent, models })}\n`,
          EXIT_SUCCESS,
        );
      }

      return writeStdoutAndExit(renderAgent(agent, models), EXIT_SUCCESS);
    });
}

function renderAgent(agent: AgentView, models: AgentModelsView): string {
  const entries: [string, string][] = [
    ["NAME", agent.name],
    ["ID", agent.id],
    ["TEMPLATE", agent.templateId ?? "<custom>"],
    ["IMAGE", agent.image],
    ["STATE", displayState(agent)],
  ];
  if (agent.description) entries.push(["DESCRIPTION", agent.description]);
  entries.push(["CHANNELS", renderChannels(agent.channels)]);
  entries.push(...modelEntries(models));
  if (agent.state === "error" && agent.error)
    entries.push(["ERROR", agent.error]);
  return renderEntries(entries);
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
