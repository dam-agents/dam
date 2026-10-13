import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildDailyCommand } from "./commands/daily.js";
import { buildLimitCommand } from "./commands/limit.js";
import { buildStatusCommand } from "./commands/status.js";
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
  const deps = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createSpendService: (host: string) =>
      createSpendService({ trpc: opts.buildTrpc(host) }),
  };
  const parent = new Command("spend").description(
    "Show the spend that each Agent's gateway measured, and set Spend Limits",
  );
  parent.addCommand(buildStatusCommand(deps));
  parent.addCommand(buildDailyCommand(deps));
  parent.addCommand(buildLimitCommand(deps));
  return { commands: [parent] };
}
