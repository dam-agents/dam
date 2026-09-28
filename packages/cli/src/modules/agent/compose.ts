import { Command } from "commander";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TemplateService } from "../template/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
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
  buildTrpc: (host: string) => TrpcClient;
  configService: ConfigService;
  compatService: CompatService;
  templateService: (host: string) => TemplateService;
}

export interface AgentModule {
  commands: ReadonlyArray<Command>;
  exports: { createService: (host: string) => AgentService };
}

export function composeAgentModule(opts: AgentModuleOptions): AgentModule {
  const createService = (host: string): AgentService =>
    createAgentService({ trpc: opts.buildTrpc(host) });

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
  const createDeps = {
    ...shared,
    createTemplateService: opts.templateService,
    createTrpcClient: opts.buildTrpc,
  };
  parent.addCommand(buildCreateCommand(createDeps));
  parent.addCommand(buildCreateInteractiveCommand(createDeps));
  parent.addCommand(buildDeleteCommand(shared));
  parent.addCommand(buildRestartCommand(shared));

  return { commands: [parent], exports: { createService } };
}
