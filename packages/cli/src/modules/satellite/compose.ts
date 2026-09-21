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
import { buildServeCommand } from "./commands/serve.js";

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

  const parent = new Command("satellite").description(
    "Run and manage satellites — machines outside the platform that expose a fixed set of commands",
  );
  parent.addCommand(buildServeCommand(shared));
  parent.addCommand(buildListCommand(shared));
  parent.addCommand(buildJobsCommand(shared));
  parent.addCommand(buildGrantCommand(shared, false));
  parent.addCommand(buildGrantCommand(shared, true));
  parent.addCommand(buildCancelCommand(shared));
  parent.addCommand(buildRemoveCommand(shared));
  return { commands: [parent] };
}
