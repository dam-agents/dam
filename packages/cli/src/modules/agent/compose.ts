import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TemplateService } from "../template/index.js";
import {
  createTrpcClient,
  type TrpcClient,
} from "../shared/trpc/trpc-client.js";
import { buildCreateCommand } from "./commands/create.js";
import { buildCreateInteractiveCommand } from "./commands/create-interactive.js";
import { buildDeleteCommand } from "./commands/delete.js";
import { buildGetCommand } from "./commands/get.js";
import { buildListCommand } from "./commands/list.js";
import { buildRestartCommand } from "./commands/restart.js";
import {
  createAgentService,
  type AgentService,
} from "./services/agent-service.js";

/**
 * Composition options for the `agent` module. The host (Active Host URL)
 * is resolved per-command after commander parses `--server`, so the
 * module exposes factories the command actions invoke with the resolved
 * host.
 *
 * The `agent` parent owns the full lifecycle surface that
 * previously split between `agent` (interactive) and `instance`
 * (scripted): create, create-interactive, list, get, delete, restart.
 */
export interface AgentModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  /** Env var name for the server URL — surfaced in the
   *  `no server configured` hints in command actions. */
  serverEnvVar: string;
  /** Per-host factory for the template service (used to fetch the
   *  template picker's option list and to validate `--template`). */
  templateService: (host: string) => TemplateService;
}

export interface AgentModule {
  commands: ReadonlyArray<Command>;
  exports: { createService: (host: string) => AgentService };
}

export function composeAgentModule(opts: AgentModuleOptions): AgentModule {
  const buildTrpc = (host: string): TrpcClient =>
    createTrpcClient({ host, tokenProvider: opts.tokenProvider });

  const createService = (host: string): AgentService =>
    createAgentService({ trpc: buildTrpc(host) });

  const shared = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: createService,
  };

  const parent = new Command("agent").description(
    "Address Agents by name or ID",
  );
  parent.addCommand(buildListCommand(shared), { isDefault: true });
  parent.addCommand(buildGetCommand(shared));
  parent.addCommand(
    buildCreateCommand({
      ...shared,
      createTemplateService: opts.templateService,
      createTrpcClient: buildTrpc,
    }),
  );
  parent.addCommand(
    buildCreateInteractiveCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createAgentService: createService,
      createTemplateService: opts.templateService,
      createTrpcClient: buildTrpc,
      serverEnvVar: opts.serverEnvVar,
    }),
  );
  parent.addCommand(buildDeleteCommand(shared));
  parent.addCommand(buildRestartCommand(shared));

  return { commands: [parent], exports: { createService } };
}
