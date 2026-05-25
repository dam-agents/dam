import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import {
  createTrpcClient,
  type TrpcClient,
} from "../shared/trpc/trpc-client.js";
import { buildListCommand } from "./commands/list.js";
import { buildPresetCommand } from "./commands/preset.js";
import { buildTrustedHostsCommand } from "./commands/trusted-hosts.js";
import {
  createEgressService,
  type EgressService,
} from "./services/egress-service.js";

export interface EgressModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  /** Per-host factory the resolver inside agent-scoped commands consumes. */
  createAgentService: (host: string) => AgentService;
}

export interface EgressModule {
  commands: ReadonlyArray<Command>;
  exports: { createService: (host: string) => EgressService };
}

export function composeEgressModule(opts: EgressModuleOptions): EgressModule {
  const buildTrpc = (host: string): TrpcClient =>
    createTrpcClient({ host, tokenProvider: opts.tokenProvider });

  const createService = (host: string): EgressService =>
    createEgressService({ trpc: buildTrpc(host) });

  const shared = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createEgressService: createService,
  };

  const parent = new Command("egress").description(
    "Manage per-Agent egress rules (the pre-approvals that let an Agent reach external hosts)",
  );
  parent.addCommand(buildListCommand(shared));
  parent.addCommand(buildPresetCommand(shared));
  // Mutation commands (create / update / revoke / apply-preset) land in sub-issue 04.
  parent.addCommand(
    buildTrustedHostsCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createEgressService: createService,
    }),
  );

  return { commands: [parent], exports: { createService } };
}
