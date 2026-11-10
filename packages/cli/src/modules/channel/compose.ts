import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import type { SharingService } from "../sharing/index.js";
import { buildAvailableCommand } from "./commands/available.js";
import { buildListCommand } from "./commands/list.js";
import { buildSlackConnectCommand } from "./commands/slack-connect.js";
import { buildSlackDisconnectCommand } from "./commands/slack-disconnect.js";
import {
  buildSlackDmConnectCommand,
  buildSlackDmDisconnectCommand,
  buildSlackDmStatusCommand,
} from "./commands/slack-dm.js";
import {
  createChannelService,
  type ChannelService,
} from "./services/channel-service.js";

export interface ChannelModuleOptions {
  buildTrpc: (host: string) => TrpcClient;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
  createSharingService: (host: string) => SharingService;
}

export interface ChannelModule {
  commands: ReadonlyArray<Command>;
  exports: { createService: (host: string) => ChannelService };
}

export function composeChannelModule(
  opts: ChannelModuleOptions,
): ChannelModule {
  const createService = (host: string): ChannelService =>
    createChannelService({ trpc: opts.buildTrpc(host) });

  const serviceScoped = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createChannelService: createService,
  };

  const agentScoped = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createChannelService: createService,
    createSharingService: opts.createSharingService,
  };

  const parent = new Command("channel").description(
    "Manage messenger channel bindings (Telegram chats bind in-chat via the bind command)",
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

  const slackDm = new Command("slack-dm").description(
    "Pair your Slack account with a DAM Agent's 1:1 DM with the bot (the DM Bridge)",
  );
  slackDm.addCommand(buildSlackDmStatusCommand(serviceScoped));
  slackDm.addCommand(buildSlackDmConnectCommand(agentScoped));
  slackDm.addCommand(buildSlackDmDisconnectCommand(agentScoped));
  parent.addCommand(slackDm);

  return { commands: [parent], exports: { createService } };
}
