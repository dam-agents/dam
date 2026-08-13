import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TemplateService } from "../template/index.js";
import {
  createTrpcClient,
  type TrpcClient,
} from "../shared/trpc/trpc-client.js";
import { buildCreateCommand } from "./commands/create.js";
import { buildCreateInteractiveCommand } from "./commands/create-interactive.js";
import { buildDeleteCommand } from "./commands/delete.js";
import { buildGetCommand } from "./commands/get.js";
import { buildListCommand } from "./commands/list.js";
import { buildRestartCommand } from "./commands/restart.js";
import {
  createAgentService,
  type AgentService,
} from "./services/agent-service.js";

export interface AgentModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  serverEnvVar: string;
  templateService: (host: string) => TemplateService;
}

export interface AgentModule {
  commands: ReadonlyArray<Command>;
  exports: { createService: (host: string) => AgentService };
}

export function composeAgentModule(opts: AgentModuleOptions): AgentModule {
  const buildTrpc = (host: string): TrpcClient =>
    createTrpcClient({ host, tokenProvider: opts.tokenProvider });

  const createService = (host: string): AgentService =>
    createAgentService({ trpc: buildTrpc(host) });

  const shared = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: createService,
  };

  const parent = new Command("agent").description(
    "Address Agents by name or ID",
  );
  parent.addCommand(buildListCommand(shared), { isDefault: true });
  parent.addCommand(buildGetCommand(shared));
  parent.addCommand(
    buildCreateCommand({
      ...shared,
      createTemplateService: opts.templateService,
      createTrpcClient: buildTrpc,
    }),
  );
  parent.addCommand(
    buildCreateInteractiveCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createAgentService: createService,
      createTemplateService: opts.templateService,
      createTrpcClient: buildTrpc,
      serverEnvVar: opts.serverEnvVar,
    }),
  );
  parent.addCommand(buildDeleteCommand(shared));
  parent.addCommand(buildRestartCommand(shared));

  return { commands: [parent], exports: { createService } };
}
