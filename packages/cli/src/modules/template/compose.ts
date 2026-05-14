import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import { createTrpcClient } from "../shared/trpc/trpc-client.js";
import { createBearerSupplier } from "../shared/trpc/bearer-supplier.js";
import { buildListCommand } from "./commands/list.js";
import {
  createTemplateService,
  type TemplateService,
} from "./services/template-service.js";

export interface TemplateModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  serverEnvVar: string;
}

export interface TemplateModule {
  commands: ReadonlyArray<Command>;
  exports: {
    createService: (host: string) => TemplateService;
  };
}

export function composeTemplateModule(opts: TemplateModuleOptions): TemplateModule {
  const createService = (host: string): TemplateService => {
    const trpc = createTrpcClient({
      host,
      getToken: createBearerSupplier(opts.tokenProvider, host),
    });
    return createTemplateService({ trpc });
  };

  const parent = new Command("template").description(
    "Discover agent templates on the active host",
  );
  parent.addCommand(
    buildListCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createTemplateService: createService,
      serverEnvVar: opts.serverEnvVar,
    }),
    { isDefault: true },
  );

  return {
    commands: [parent],
    exports: { createService },
  };
}
