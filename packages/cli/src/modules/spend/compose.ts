import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildDailyCommand } from "./commands/daily.js";
import { createSpendService } from "./services/spend-service.js";

export interface SpendModuleOptions {
  buildTrpc: (host: string) => TrpcClient;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

export interface SpendModule {
  commands: ReadonlyArray<Command>;
}

export function composeSpendModule(opts: SpendModuleOptions): SpendModule {
  const parent = new Command("spend").description(
    "Show the spend that each Agent's gateway measured",
  );
  parent.addCommand(
    buildDailyCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createAgentService: opts.createAgentService,
      createSpendService: (host) =>
        createSpendService({ trpc: opts.buildTrpc(host) }),
    }),
  );
  return { commands: [parent] };
}
