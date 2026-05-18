import { Command } from "commander";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildListCommand } from "./commands/list.js";
import {
  createTemplateService,
  type TemplateService,
} from "./services/template-service.js";

export interface TemplateModule {
  commands: ReadonlyArray<Command>;
  exports: {
    createService: (host: string) => TemplateService;
  };
}

export function composeTemplateModule(opts: {
  buildTrpc: (host: string) => TrpcClient;
  configService: ConfigService;
  compatService: CompatService;
}): TemplateModule {
  const createService = (host: string): TemplateService =>
    createTemplateService({ trpc: opts.buildTrpc(host) });

  const parent = new Command("template").description(
    "Discover agent templates on the active host",
  );
  parent.addCommand(
    buildListCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createTemplateService: createService,
    }),
    { isDefault: true },
  );

  return {
    commands: [parent],
    exports: { createService },
  };
}
