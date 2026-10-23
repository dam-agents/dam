import { Command } from "commander";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TemplateService } from "../template/index.js";
import type { TokenProvider } from "../auth/index.js";
import {
  createAgentTrpcClient,
  type TrpcClient,
} from "../shared/trpc/trpc-client.js";
import { buildAvatarsCommand } from "./commands/avatars.js";
import { buildCreateCommand } from "./commands/create.js";
import { buildCreateInteractiveCommand } from "./commands/create-interactive.js";
import { buildDeleteCommand } from "./commands/delete.js";
import { buildDisableCommand } from "./commands/disable.js";
import { buildGetCommand } from "./commands/get.js";
import { buildListCommand } from "./commands/list.js";
import { buildModelsCommand } from "./commands/models.js";
import { buildRestartCommand } from "./commands/restart.js";
import { buildUpdateCommand } from "./commands/update.js";
import {
  createAgentModelsService,
  type AgentModelsService,
} from "./services/agent-models-service.js";
import {
  createAgentService,
  type AgentService,
} from "./services/agent-service.js";
import {
  createAvatarUploader,
  type AvatarUploader,
} from "./infrastructure/avatar-upload-client.js";

export interface AgentModuleOptions {
  buildTrpc: (host: string) => TrpcClient;
  tokenProvider: TokenProvider;
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

  const createModelsService = (host: string): AgentModelsService =>
    createAgentModelsService({
      trpc: opts.buildTrpc(host),
      agentTrpc: (agentId) =>
        createAgentTrpcClient({
          host,
          agentId,
          tokenProvider: opts.tokenProvider,
        }),
    });

  const createUploader = (host: string): AvatarUploader =>
    createAvatarUploader({
      host,
      getToken: async () => {
        const token = await opts.tokenProvider.getValidAccessToken(host);
        return token.ok ? token.value : null;
      },
    });

  const shared = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: createService,
  };
  const withModels = {
    ...shared,
    createAgentModelsService: createModelsService,
  };
  const withIdentity = { ...withModels, createAvatarUploader: createUploader };

  const parent = new Command("agent").description(
    "Address Agents by name or ID",
  );
  parent.addCommand(buildListCommand(shared), { isDefault: true });
  parent.addCommand(buildGetCommand(withModels));
  const createDeps = {
    ...shared,
    createTemplateService: opts.templateService,
    createTrpcClient: opts.buildTrpc,
    createAvatarUploader: createUploader,
  };
  parent.addCommand(buildCreateCommand(createDeps));
  parent.addCommand(buildCreateInteractiveCommand(createDeps));
  parent.addCommand(buildUpdateCommand(withIdentity));
  parent.addCommand(buildAvatarsCommand(shared));
  parent.addCommand(buildModelsCommand(withModels));
  parent.addCommand(buildDeleteCommand(shared));
  parent.addCommand(buildRestartCommand(shared));
  parent.addCommand(buildDisableCommand(shared, true));
  parent.addCommand(buildDisableCommand(shared, false));

  return { commands: [parent], exports: { createService } };
}
