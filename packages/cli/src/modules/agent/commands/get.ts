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
import { renderAvatar } from "../domain/agent-avatar.js";
import { resolveAgentOrExit } from "./errors.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import {
  describeKitUpdate,
  parseAgentKitRef,
  type KitService,
} from "../../kit/index.js";
import type { KitUpdateStatus } from "api-server-api";

export function buildGetCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createAgentModelsService: (host: string) => AgentModelsService;
  createKitService: (host: string) => KitService;
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
      "emit the agent as JSON, with a `models` object: its providers, harnesses and defaults, and for an agent created from a starter kit a `kitUpdate` object: its update state",
    )
    .addHelpText(
      "after",
      "\nExamples:\n  dam agent get my-agent\n  dam agent get agent-3f9c2b7e41d08a65 --json\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);

      const svc = deps.createAgentService(host);
      const agent = await resolveAgentOrExit(svc, ref, host);
      const [models, kitUpdate] = await Promise.all([
        readAgentModels(deps.createAgentModelsService(host), agent.id),
        readKitUpdate(deps.createKitService(host), agent),
      ]);

      if (opts.json) {
        return writeStdoutAndExit(
          `${JSON.stringify({ ...agent, models, ...(agent.starterKit && { kitUpdate }) })}\n`,
          EXIT_SUCCESS,
        );
      }

      return writeStdoutAndExit(
        renderAgent(agent, models, kitUpdate),
        EXIT_SUCCESS,
      );
    });
}

async function readKitUpdate(
  svc: KitService,
  agent: AgentView,
): Promise<KitUpdateStatus | null> {
  if (!agent.starterKit) return null;
  const updates = await svc.updates();
  if (!updates.ok) return null;
  return updates.value.find((u) => u.agentId === agent.id) ?? null;
}

function renderKit(starterKit: string): string {
  const ref = parseAgentKitRef(starterKit);
  if (!ref) return starterKit;
  return `${ref.kit} (${ref.catalog}/${ref.kit}${ref.version ? `@${ref.version.slice(0, 9)}` : ""})`;
}

function renderAgent(
  agent: AgentView,
  models: AgentModelsView,
  kitUpdate: KitUpdateStatus | null,
): string {
  const entries: [string, string][] = [
    ["NAME", agent.name],
    ["ID", agent.id],
    ["TEMPLATE", agent.templateId ?? "<custom>"],
    ["IMAGE", agent.image],
    ["STATE", displayState(agent)],
    ["AVATAR", renderAvatar(agent.avatar)],
  ];
  if (agent.description) entries.push(["DESCRIPTION", agent.description]);
  if (agent.starterKit) {
    entries.push(["STARTER KIT", renderKit(agent.starterKit)]);
    entries.push(["KIT UPDATE", describeKitUpdate(kitUpdate, agent.name)]);
  }
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
