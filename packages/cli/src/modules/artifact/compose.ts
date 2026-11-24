import { Command } from "commander";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildShareCommand } from "./commands/share.js";
import { createArtifactService } from "./services/artifact-service.js";

export interface ArtifactModuleOptions {
  buildTrpc: (host: string) => TrpcClient;
  configService: ConfigService;
  compatService: CompatService;
}

export interface ArtifactModule {
  commands: ReadonlyArray<Command>;
}

export function composeArtifactModule(
  opts: ArtifactModuleOptions,
): ArtifactModule {
  const parent = new Command("artifact").description(
    "See and change who can open your artifacts",
  );
  parent.addCommand(
    buildShareCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createArtifactService: (host) =>
        createArtifactService({ trpc: opts.buildTrpc(host) }),
    }),
  );
  return { commands: [parent] };
}
