import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { BrowserOpener, TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import {
  createTrpcClient,
  type TrpcClient,
} from "../shared/trpc/trpc-client.js";
import { buildConnectCommand } from "./commands/connect.js";
import { buildDisconnectCommand } from "./commands/disconnect.js";
import { buildGrantCommand } from "./commands/grant.js";
import { buildListCommand } from "./commands/list.js";
import { buildReauthCommand } from "./commands/reauth.js";
import { buildRevokeCommand } from "./commands/revoke.js";
import { buildTemplatesCommand } from "./commands/templates.js";
import { buildUpdateCommand } from "./commands/update.js";
import {
  createConnectionService,
  type ConnectionService,
} from "./services/connection-service.js";

export interface ConnectionModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
  browserOpener: BrowserOpener;
}

export interface ConnectionModule {
  commands: ReadonlyArray<Command>;
  exports: { createService: (host: string) => ConnectionService };
}

export function composeConnectionModule(
  opts: ConnectionModuleOptions,
): ConnectionModule {
  const buildTrpc = (host: string): TrpcClient =>
    createTrpcClient({ host, tokenProvider: opts.tokenProvider });

  const createService = (host: string): ConnectionService =>
    createConnectionService({ trpc: buildTrpc(host) });

  const agentScoped = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createConnectionService: createService,
  };

  const parent = new Command("connection").description(
    "Manage OAuth connections and agent connection grants",
  );
  parent.addCommand(buildListCommand(agentScoped));
  parent.addCommand(
    buildTemplatesCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createConnectionService: createService,
    }),
  );
  parent.addCommand(
    buildConnectCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createConnectionService: createService,
      browserOpener: opts.browserOpener,
    }),
  );
  parent.addCommand(
    buildDisconnectCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createConnectionService: createService,
    }),
  );
  parent.addCommand(
    buildUpdateCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createConnectionService: createService,
    }),
  );
  parent.addCommand(
    buildReauthCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createConnectionService: createService,
      browserOpener: opts.browserOpener,
    }),
  );
  parent.addCommand(buildGrantCommand(agentScoped));
  parent.addCommand(buildRevokeCommand(agentScoped));

  return { commands: [parent], exports: { createService } };
}
