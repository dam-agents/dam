import type { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { TokenProvider } from "../auth/index.js";
import { buildSessionsPort } from "../chat/compose.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import { createTrpcClient } from "../shared/trpc/trpc-client.js";
import { buildTelemetryCommand } from "./commands/show.js";
import { createTelemetryService } from "./services/telemetry-service.js";

export interface TelemetryModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

export interface TelemetryModule {
  commands: ReadonlyArray<Command>;
}

export function composeTelemetryModule(
  opts: TelemetryModuleOptions,
): TelemetryModule {
  return {
    commands: [
      buildTelemetryCommand({
        compatService: opts.compatService,
        configService: opts.configService,
        tokenProvider: opts.tokenProvider,
        createAgentService: opts.createAgentService,
        createSessionsPort: buildSessionsPort,
        createTelemetryService: (host) =>
          createTelemetryService({
            trpc: createTrpcClient({ host, tokenProvider: opts.tokenProvider }),
          }),
      }),
    ],
  };
}
