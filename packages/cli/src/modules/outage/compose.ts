import { Command } from "commander";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildListCommand } from "./commands/list.js";
import {
  createOutageService,
  type OutageService,
} from "./services/outage-service.js";

export interface OutageModuleOptions {
  buildTrpc: (host: string) => TrpcClient;
  configService: ConfigService;
  compatService: CompatService;
}

export interface OutageModule {
  commands: ReadonlyArray<Command>;
}

export function composeOutageModule(opts: OutageModuleOptions): OutageModule {
  const createService = (host: string): OutageService =>
    createOutageService({ trpc: opts.buildTrpc(host) });

  const parent = new Command("outage").description(
    "Read the model provider outages and your outage alerts",
  );
  parent.addCommand(
    buildListCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createOutageService: createService,
    }),
  );

  return { commands: [parent] };
}
