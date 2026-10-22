import type { Command } from "commander";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildBudgetCommand } from "./commands/budget.js";
import { createBudgetService } from "./services/budget-service.js";

export interface BudgetModuleOptions {
  buildTrpc: (host: string) => TrpcClient;
  configService: ConfigService;
  compatService: CompatService;
}

export interface BudgetModule {
  commands: ReadonlyArray<Command>;
}

export function composeBudgetModule(opts: BudgetModuleOptions): BudgetModule {
  return {
    commands: [
      buildBudgetCommand({
        compatService: opts.compatService,
        configService: opts.configService,
        createBudgetService: (host) =>
          createBudgetService({ trpc: opts.buildTrpc(host) }),
      }),
    ],
  };
}
