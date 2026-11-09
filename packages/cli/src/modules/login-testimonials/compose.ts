import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildLoginTestimonialsCommands } from "./commands/login-testimonials.js";
import { createLoginTestimonialsService } from "./services/login-testimonials-service.js";

export interface LoginTestimonialsModuleOptions {
  buildTrpc: (host: string) => TrpcClient;
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
}

export function composeLoginTestimonialsModule(
  opts: LoginTestimonialsModuleOptions,
) {
  const parent = new Command("login-testimonials").description(
    "List, export and import the testimonials the login page shows (platform operators only)",
  );
  for (const command of buildLoginTestimonialsCommands({
    compatService: opts.compatService,
    configService: opts.configService,
    createService: (host) =>
      createLoginTestimonialsService({
        host,
        trpc: opts.buildTrpc(host),
        tokenProvider: opts.tokenProvider,
      }),
  }))
    parent.addCommand(command);
  return { commands: [parent] as ReadonlyArray<Command> };
}
