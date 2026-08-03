import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import { createTrpcClient } from "../shared/trpc/trpc-client.js";
import { buildAcceptCommand } from "./commands/accept.js";
import { buildShowCommand } from "./commands/show.js";
import { buildStatusCommand } from "./commands/status.js";
import {
  createTermsService,
  type TermsService,
} from "./services/terms-service.js";

export interface TermsModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
}

export interface TermsModule {
  commands: ReadonlyArray<Command>;
}

export function composeTermsModule(opts: TermsModuleOptions): TermsModule {
  const createService = (host: string): TermsService =>
    createTermsService({
      trpc: createTrpcClient({ host, tokenProvider: opts.tokenProvider }),
      host,
    });
  const scoped = {
    compatService: opts.compatService,
    configService: opts.configService,
    createTermsService: createService,
  };

  const parent = new Command("terms").description(
    "View and accept the deployment's Terms of Use",
  );
  parent.addCommand(buildShowCommand(scoped));
  parent.addCommand(buildStatusCommand(scoped));
  parent.addCommand(buildAcceptCommand(scoped));

  return { commands: [parent] };
}
