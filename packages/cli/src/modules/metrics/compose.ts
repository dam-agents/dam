import type { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { TokenProvider } from "../auth/index.js";
import { buildSessionsPort } from "../chat/compose.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import { createTrpcClient } from "../shared/trpc/trpc-client.js";
import { buildMetricsCommand } from "./commands/show.js";
import { createMetricsService } from "./services/metrics-service.js";

export interface MetricsModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

export interface MetricsModule {
  commands: ReadonlyArray<Command>;
}

export function composeMetricsModule(
  opts: MetricsModuleOptions,
): MetricsModule {
  return {
    commands: [
      buildMetricsCommand({
        compatService: opts.compatService,
        configService: opts.configService,
        tokenProvider: opts.tokenProvider,
        createAgentService: opts.createAgentService,
        createSessionsPort: buildSessionsPort,
        createMetricsService: (host) =>
          createMetricsService({
            trpc: createTrpcClient({ host, tokenProvider: opts.tokenProvider }),
          }),
      }),
    ],
  };
}
