import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import {
  createTrpcClient,
  type TrpcClient,
} from "../shared/trpc/trpc-client.js";
import { buildAllowCommand } from "./commands/allow.js";
import { buildAvailableCommand } from "./commands/available.js";
import { buildDisallowCommand } from "./commands/disallow.js";
import { buildListCommand } from "./commands/list.js";
import { buildSlackConnectCommand } from "./commands/slack-connect.js";
import { buildSlackDisconnectCommand } from "./commands/slack-disconnect.js";
import { buildTelegramConnectCommand } from "./commands/telegram-connect.js";
import { buildTelegramDisconnectCommand } from "./commands/telegram-disconnect.js";
import {
  createChannelService,
  type ChannelService,
} from "./services/channel-service.js";

export interface ChannelModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  /** Per-host factory the resolver inside agent-scoped commands consumes. */
  createAgentService: (host: string) => AgentService;
}

export interface ChannelModule {
  commands: ReadonlyArray<Command>;
  exports: { createService: (host: string) => ChannelService };
}

export function composeChannelModule(
  opts: ChannelModuleOptions,
): ChannelModule {
  const buildTrpc = (host: string): TrpcClient =>
    createTrpcClient({ host, tokenProvider: opts.tokenProvider });

  const createService = (host: string): ChannelService =>
    createChannelService({ trpc: buildTrpc(host) });

  // Shared by the agent-scoped binding verbs; the provider sub-groups keep
  // their own flags/help while routing through the same resolver + service.
  const agentScoped = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createChannelService: createService,
  };

  const parent = new Command("channel").description(
    "Manage messenger channel bindings (Slack, Telegram)",
  );
  parent.addCommand(
    buildAvailableCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createChannelService: createService,
    }),
  );
  parent.addCommand(
    buildListCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createAgentService: opts.createAgentService,
    }),
  );

  const slack = new Command("slack").description(
    "Bind or unbind an Agent's Slack channel",
  );
  slack.addCommand(buildSlackConnectCommand(agentScoped));
  slack.addCommand(buildSlackDisconnectCommand(agentScoped));
  parent.addCommand(slack);

  const telegram = new Command("telegram").description(
    "Bind or unbind an Agent's Telegram bot",
  );
  telegram.addCommand(buildTelegramConnectCommand(agentScoped));
  telegram.addCommand(buildTelegramDisconnectCommand(agentScoped));
  parent.addCommand(telegram);

  // allow/disallow touch only the Agent's allowedUserEmails field, so they need
  // the resolver + AgentService but no ChannelService.
  const allowScoped = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
  };
  parent.addCommand(buildAllowCommand(allowScoped));
  parent.addCommand(buildDisallowCommand(allowScoped));

  return { commands: [parent], exports: { createService } };
}
