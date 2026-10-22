import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { ConnectionService } from "../connection/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildCeilingCommand } from "./commands/ceiling.js";
import { buildDailyCommand } from "./commands/daily.js";
import { buildLimitCommand } from "./commands/limit.js";
import { buildStatusCommand } from "./commands/status.js";
import {
  createSpendService,
  type SpendService,
} from "./services/spend-service.js";

export interface SpendModuleOptions {
  buildTrpc: (host: string) => TrpcClient;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
  createConnectionService: (host: string) => ConnectionService;
}

export interface SpendModule {
  commands: ReadonlyArray<Command>;
  exports: { createService: (host: string) => SpendService };
}

export function composeSpendModule(opts: SpendModuleOptions): SpendModule {
  const createService = (host: string) =>
    createSpendService({ trpc: opts.buildTrpc(host) });
  const deps = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createConnectionService: opts.createConnectionService,
    createSpendService: createService,
  };
  const parent = new Command("spend").description(
    "Show the spend that each Agent's gateway measured, set Spend Limits, and, for platform operators, Spend Ceilings",
  );
  parent.addCommand(buildStatusCommand(deps));
  parent.addCommand(buildDailyCommand(deps));
  parent.addCommand(buildLimitCommand(deps));
  parent.addCommand(buildCeilingCommand(deps));
  return { commands: [parent], exports: { createService } };
}
