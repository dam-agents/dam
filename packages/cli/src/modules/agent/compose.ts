import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { InstanceService } from "../instance/index.js";
import type { TemplateService } from "../template/index.js";
import { createTrpcClient, type TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildCreateCommand } from "./commands/create.js";

/**
 * Composition options for the `agent` module. Mirrors `instance`'s
 * compose surface — the host (Active Host URL) is resolved per-command
 * after commander parses `--server`, so the module exposes factories
 * the command actions invoke with the resolved host.
 */
export interface AgentModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  /** Env var name for the server URL — surfaced in the
   *  `no server configured` hints in command actions. */
  serverEnvVar: string;
  /** Per-host factory for the template service (used by issue 003 to
   *  fetch the template picker's option list). */
  templateService: (host: string) => TemplateService;
  /** Per-host factory for the instance service (used by issue 006 to
   *  poll instance state after creation). */
  instanceService: (host: string) => InstanceService;
}

export interface AgentModule {
  commands: ReadonlyArray<Command>;
}

export function composeAgentModule(opts: AgentModuleOptions): AgentModule {
  const buildTrpc = (host: string): TrpcClient =>
    createTrpcClient({ host, tokenProvider: opts.tokenProvider });

  const parent = new Command("agent").description(
    "Create and manage agents interactively",
  );
  parent.addCommand(
    buildCreateCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createInstanceService: opts.instanceService,
      createTemplateService: opts.templateService,
      createTrpcClient: buildTrpc,
      serverEnvVar: opts.serverEnvVar,
    }),
  );

  return { commands: [parent] };
}
