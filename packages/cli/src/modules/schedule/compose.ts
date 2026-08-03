import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import {
  createTrpcClient,
  type TrpcClient,
} from "../shared/trpc/trpc-client.js";
import { buildCreateCommand } from "./commands/create.js";
import { buildDeleteCommand } from "./commands/delete.js";
import { buildDisableCommand } from "./commands/disable.js";
import { buildEnableCommand } from "./commands/enable.js";
import { buildGetCommand } from "./commands/get.js";
import { buildListCommand } from "./commands/list.js";
import { buildResetSessionCommand } from "./commands/reset-session.js";
import { buildUpdateCommand } from "./commands/update.js";
import {
  createScheduleService,
  type ScheduleService,
} from "./services/schedule-service.js";

export interface ScheduleModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  /** Per-host factory the resolver inside agent-scoped commands consumes. */
  createAgentService: (host: string) => AgentService;
}

export interface ScheduleModule {
  commands: ReadonlyArray<Command>;
  exports: { createService: (host: string) => ScheduleService };
}

export function composeScheduleModule(
  opts: ScheduleModuleOptions,
): ScheduleModule {
  const buildTrpc = (host: string): TrpcClient =>
    createTrpcClient({ host, tokenProvider: opts.tokenProvider });

  const createService = (host: string): ScheduleService =>
    createScheduleService({ trpc: buildTrpc(host) });

  const agentScoped = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createScheduleService: createService,
  };
  const idScoped = {
    compatService: opts.compatService,
    configService: opts.configService,
    createScheduleService: createService,
  };

  const parent = new Command("schedule").description(
    "Manage time-triggered tasks (schedules) attached to an Agent",
  );
  parent.addCommand(buildListCommand(agentScoped));
  parent.addCommand(buildGetCommand(idScoped));
  parent.addCommand(buildCreateCommand(agentScoped));
  parent.addCommand(buildUpdateCommand(idScoped));
  parent.addCommand(buildEnableCommand(idScoped));
  parent.addCommand(buildDisableCommand(idScoped));
  parent.addCommand(buildDeleteCommand(idScoped));
  parent.addCommand(buildResetSessionCommand(idScoped));

  return { commands: [parent], exports: { createService } };
}
