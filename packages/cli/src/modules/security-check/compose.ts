import { Command } from "commander";

import type { CompatService, ConfigService } from "../cli/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildReportCommand } from "./commands/report.js";
import {
  createSecurityCheckService,
  type SecurityCheckService,
} from "./services/security-check-service.js";

export interface SecurityCheckModuleOptions {
  buildTrpc: (host: string) => TrpcClient;
  configService: ConfigService;
  compatService: CompatService;
}

export interface SecurityCheckModule {
  commands: ReadonlyArray<Command>;
}

export function composeSecurityCheckModule(
  opts: SecurityCheckModuleOptions,
): SecurityCheckModule {
  const createService = (host: string): SecurityCheckService =>
    createSecurityCheckService({ trpc: opts.buildTrpc(host) });
  const parent = new Command("security-check").description(
    "Report what a security check of the person's setup found",
  );
  parent.addCommand(
    buildReportCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createSecurityCheckService: createService,
    }),
  );
  return { commands: [parent] };
}
