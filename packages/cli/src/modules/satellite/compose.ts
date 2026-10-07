import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import {
  buildCancelCommand,
  buildGrantCommand,
  buildJobsCommand,
  buildListCommand,
  buildRemoveCommand,
} from "./commands/manage.js";
import { buildShellCommand } from "./commands/shell.js";
import { buildMcpCommand } from "./commands/mcp.js";

export interface SatelliteModuleOptions {
  buildTrpc: (host: string) => TrpcClient;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

export function composeSatelliteModule(opts: SatelliteModuleOptions): {
  commands: ReadonlyArray<Command>;
} {
  const shared = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createTrpc: opts.buildTrpc,
  };

  const parent = new Command("satellite")
    .description(
      "[experimental] Run and manage satellites — machines outside the platform that expose tools to an agent",
    )
    .addHelpText(
      "after",
      "\nSatellites are experimental: the commands work, but the shape of a\n" +
        "manifest, the tools an agent sees and the contract between them may\n" +
        "change without a deprecation. There is no web UI for them yet.\n",
    );
  parent.addCommand(buildMcpCommand(shared));
  parent.addCommand(buildShellCommand(shared));
  parent.addCommand(buildListCommand(shared));
  parent.addCommand(buildJobsCommand(shared));
  parent.addCommand(buildGrantCommand(shared, false));
  parent.addCommand(buildGrantCommand(shared, true));
  parent.addCommand(buildCancelCommand(shared));
  parent.addCommand(buildRemoveCommand(shared));
  return { commands: [parent] };
}
