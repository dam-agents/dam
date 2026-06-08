import { Command } from "commander";
import type { AgentService } from "../agent/index.js";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import {
  createTrpcClient,
  type TrpcClient,
} from "../shared/trpc/trpc-client.js";
import { buildCatalogCommand } from "./commands/catalog.js";
import { buildInstallCommand } from "./commands/install.js";
import { buildListCommand } from "./commands/list.js";
import { buildSourceListCommand } from "./commands/source-list.js";
import { buildUninstallCommand } from "./commands/uninstall.js";
import {
  createSkillsService,
  type SkillsService,
} from "./services/skills-service.js";

export interface SkillModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  /** Per-host factory the resolver inside agent-scoped commands consumes. */
  createAgentService: (host: string) => AgentService;
}

export interface SkillModule {
  commands: ReadonlyArray<Command>;
  exports: { createService: (host: string) => SkillsService };
}

export function composeSkillModule(opts: SkillModuleOptions): SkillModule {
  const buildTrpc = (host: string): TrpcClient =>
    createTrpcClient({ host, tokenProvider: opts.tokenProvider });

  const createService = (host: string): SkillsService =>
    createSkillsService({ trpc: buildTrpc(host) });

  const shared = {
    compatService: opts.compatService,
    configService: opts.configService,
    createAgentService: opts.createAgentService,
    createSkillsService: createService,
  };

  const parent = new Command("skill").description(
    "Browse skill sources and manage the skills installed on an Agent",
  );
  const sourceGroup = new Command("source").description(
    "Inspect connected skill sources",
  );
  sourceGroup.addCommand(buildSourceListCommand(shared));
  parent.addCommand(sourceGroup);
  parent.addCommand(buildCatalogCommand(shared));
  parent.addCommand(buildListCommand(shared));
  parent.addCommand(buildInstallCommand(shared));
  parent.addCommand(buildUninstallCommand(shared));

  return { commands: [parent], exports: { createService } };
}
