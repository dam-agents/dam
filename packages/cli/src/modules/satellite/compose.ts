import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import {
  createTrpcClient,
  type TrpcClient,
} from "../shared/trpc/trpc-client.js";
import {
  buildCancelCommand,
  buildGrantCommand,
  buildJobsCommand,
  buildListCommand,
  buildRemoveCommand,
} from "./commands/manage.js";
import { buildMcpCommand } from "./commands/mcp.js";

export interface SatelliteModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

export function composeSatelliteModule(opts: SatelliteModuleOptions): {
  commands: ReadonlyArray<Command>;
} {
  const createTrpc = (host: string): TrpcClient =>
    createTrpcClient({ host, tokenProvider: opts.tokenProvider });
  const shared = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createTrpc,
  };

  const parent = new Command("satellite")
    .description(
      "[experimental] Run and manage satellites — machines outside the platform that expose tools to an agent",
    )
    .addHelpText(
      "after",
      "\nSatellites are experimental: the commands work, but the shape of a\n" +
        "manifest, the tools an agent sees and the contract between them may\n" +
        "change without a deprecation. Turn on the Satellites experimental\n" +
        "feature to see them in the web UI as well.\n",
    );
  parent.addCommand(buildMcpCommand(shared));
  parent.addCommand(buildListCommand(shared));
  parent.addCommand(buildJobsCommand(shared));
  parent.addCommand(buildGrantCommand(shared, false));
  parent.addCommand(buildGrantCommand(shared, true));
  parent.addCommand(buildCancelCommand(shared));
  parent.addCommand(buildRemoveCommand(shared));
  return { commands: [parent] };
}
