import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import { buildListCommand } from "./commands/list.js";
import { buildShowCommand } from "./commands/show.js";
import {
  buildChangesCommand,
  buildSkipCommand,
  buildUpdateCommand,
} from "./commands/update.js";
import type { KitService } from "./services/kit-service.js";

export interface KitModuleOptions {
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
  createKitService: (host: string) => KitService;
}

export function composeKitModule(opts: KitModuleOptions): {
  commands: ReadonlyArray<Command>;
} {
  const shared = {
    compatService: opts.compatService,
    configService: opts.configService,
    createKitService: opts.createKitService,
  };
  const agentScoped = {
    ...shared,
    createAgentService: opts.createAgentService,
  };

  const parent = new Command("kit").description(
    "Discover starter kits — proven ways of working an agent is created from — and take their updates",
  );
  parent.addCommand(buildListCommand(shared), { isDefault: true });
  parent.addCommand(buildShowCommand(shared));
  parent.addCommand(buildChangesCommand(agentScoped));
  parent.addCommand(buildUpdateCommand(agentScoped));
  parent.addCommand(buildSkipCommand(agentScoped));

  return { commands: [parent] };
}
