import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import {
  createTrpcClient,
  type TrpcClient,
} from "../shared/trpc/trpc-client.js";
import { buildAvailableCommand } from "./commands/available.js";
import { buildListCommand } from "./commands/list.js";
import { buildSlackConnectCommand } from "./commands/slack-connect.js";
import { buildSlackDisconnectCommand } from "./commands/slack-disconnect.js";
import {
  createChannelService,
  type ChannelService,
} from "./services/channel-service.js";

export interface ChannelModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
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

  const agentScoped = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createChannelService: createService,
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

  return { commands: [parent], exports: { createService } };
}
