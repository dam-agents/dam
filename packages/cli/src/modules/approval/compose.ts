import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import {
  createTrpcClient,
  type TrpcClient,
} from "../shared/trpc/trpc-client.js";
import { buildApproveCommand } from "./commands/approve.js";
import { buildDenyCommand } from "./commands/deny.js";
import { buildListCommand } from "./commands/list.js";
import {
  createApprovalService,
  type ApprovalService,
} from "./services/approval-service.js";

export interface ApprovalModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  /** Per-host factory the resolver inside the list command consumes. */
  createAgentService: (host: string) => AgentService;
}

export interface ApprovalModule {
  commands: ReadonlyArray<Command>;
}

export function composeApprovalModule(
  opts: ApprovalModuleOptions,
): ApprovalModule {
  const buildTrpc = (host: string): TrpcClient =>
    createTrpcClient({ host, tokenProvider: opts.tokenProvider });

  const createService = (host: string): ApprovalService =>
    createApprovalService({ trpc: buildTrpc(host) });

  const agentScoped = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createApprovalService: createService,
  };
  const idScoped = {
    compatService: opts.compatService,
    configService: opts.configService,
    createApprovalService: createService,
  };

  const parent = new Command("approval").description(
    "Action pending approvals — the HITL prompts your Agents are waiting on (see `dam network` for the standing rules)",
  );
  parent.addCommand(buildListCommand(agentScoped));
  parent.addCommand(buildApproveCommand(idScoped));
  parent.addCommand(buildDenyCommand(idScoped));

  return { commands: [parent] };
}
