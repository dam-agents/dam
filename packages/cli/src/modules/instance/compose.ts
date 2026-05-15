import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TemplateService } from "../template/index.js";
import { createTrpcClient, type TrpcClient } from "../shared/trpc/trpc-client.js";
import { createBearerSupplier } from "../shared/trpc/bearer-supplier.js";
import { buildCreateCommand } from "./commands/create.js";
import { buildDeleteCommand } from "./commands/delete.js";
import { buildGetCommand } from "./commands/get.js";
import { buildListCommand } from "./commands/list.js";
import { buildRestartCommand } from "./commands/restart.js";
import { createInstanceService, type InstanceService } from "./services/instance-service.js";

export interface InstanceModule {
  commands: ReadonlyArray<Command>;
  exports: { createService: (host: string) => InstanceService };
}

export function composeInstanceModule(opts: {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  templateService: (host: string) => TemplateService;
}): InstanceModule {
  const buildTrpc = (host: string): TrpcClient =>
    createTrpcClient({ host, getToken: createBearerSupplier(opts.tokenProvider, host) });
  const createService = (host: string): InstanceService =>
    createInstanceService({ trpc: buildTrpc(host) });
  const shared = { compatService: opts.compatService, configService: opts.configService, createInstanceService: createService };

  const parent = new Command("instance").description("Address Instances by name or ID");
  parent.addCommand(buildListCommand(shared), { isDefault: true });
  parent.addCommand(buildGetCommand(shared));
  parent.addCommand(buildCreateCommand({ ...shared, createTemplateService: opts.templateService, createTrpcClient: buildTrpc }));
  parent.addCommand(buildDeleteCommand(shared));
  parent.addCommand(buildRestartCommand(shared));

  return { commands: [parent], exports: { createService } };
}
