import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import {
  createTrpcClient,
  type TrpcClient,
} from "../shared/trpc/trpc-client.js";
import { buildApplyPresetCommand } from "./commands/apply-preset.js";
import { buildCreateCommand } from "./commands/create.js";
import { buildListCommand } from "./commands/list.js";
import { buildPresetCommand } from "./commands/preset.js";
import { buildRevokeCommand } from "./commands/revoke.js";
import { buildTrustedHostsCommand } from "./commands/trusted-hosts.js";
import { buildUpdateCommand } from "./commands/update.js";
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

  const agentScoped = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createEgressService: createService,
  };
  const idScoped = {
    compatService: opts.compatService,
    configService: opts.configService,
    createEgressService: createService,
  };

  const parent = new Command("network").description(
    "Manage per-Agent network access rules (the pre-approvals that let an Agent reach external hosts)",
  );
  parent.addCommand(buildListCommand(agentScoped));
  parent.addCommand(buildCreateCommand(agentScoped));
  parent.addCommand(buildUpdateCommand(idScoped));
  parent.addCommand(buildRevokeCommand(idScoped));
  parent.addCommand(buildPresetCommand(agentScoped));
  parent.addCommand(buildApplyPresetCommand(agentScoped));
  parent.addCommand(buildTrustedHostsCommand(idScoped));

  return { commands: [parent], exports: { createService } };
}
