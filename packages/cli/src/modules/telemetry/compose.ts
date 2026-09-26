import type { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildTelemetryCommand } from "./commands/telemetry.js";
import { createExportClient } from "./infrastructure/export-client.js";
import { createTelemetryService } from "./services/telemetry-service.js";

export interface TelemetryModuleOptions {
  tokenProvider: TokenProvider;
  buildTrpc: (host: string) => TrpcClient;
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
        createTelemetryService: (host) =>
          createTelemetryService({ trpc: opts.buildTrpc(host) }),
        createExportClient: (host) =>
          createExportClient({
            host,
            getToken: async () => {
              const token = await opts.tokenProvider.getValidAccessToken(host);
              return token.ok ? token.value : null;
            },
          }),
      }),
    ],
  };
}
