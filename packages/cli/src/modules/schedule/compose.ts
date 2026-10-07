import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildCreateCommand } from "./commands/create.js";
import { buildDeleteCommand } from "./commands/delete.js";
import { buildGetCommand } from "./commands/get.js";
import { buildListCommand } from "./commands/list.js";
import { buildResetSessionCommand } from "./commands/reset-session.js";
import { buildToggleCommand } from "./commands/toggle-command.js";
import { buildUpdateCommand } from "./commands/update.js";
import {
  createScheduleService,
  type ScheduleService,
} from "./services/schedule-service.js";

export interface ScheduleModuleOptions {
  buildTrpc: (host: string) => TrpcClient;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

export interface ScheduleModule {
  commands: ReadonlyArray<Command>;
  exports: { createService: (host: string) => ScheduleService };
}

export function composeScheduleModule(
  opts: ScheduleModuleOptions,
): ScheduleModule {
  const createService = (host: string): ScheduleService =>
    createScheduleService({ trpc: opts.buildTrpc(host) });

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
  parent.addCommand(buildToggleCommand(idScoped, true));
  parent.addCommand(buildToggleCommand(idScoped, false));
  parent.addCommand(buildDeleteCommand(idScoped));
  parent.addCommand(buildResetSessionCommand(idScoped));

  return { commands: [parent], exports: { createService } };
}
