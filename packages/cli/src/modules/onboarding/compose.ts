import { Command } from "commander";

import type { CompatService, ConfigService } from "../cli/index.js";
import type { TrpcClient } from "../shared/trpc/trpc-client.js";
import { buildFirstResultCommand } from "./commands/first-result.js";
import {
  createOnboardingService,
  type OnboardingService,
} from "./services/onboarding-service.js";

export interface OnboardingModuleOptions {
  buildTrpc: (host: string) => TrpcClient;
  configService: ConfigService;
  compatService: CompatService;
}

export interface OnboardingModule {
  commands: ReadonlyArray<Command>;
}

export function composeOnboardingModule(
  opts: OnboardingModuleOptions,
): OnboardingModule {
  const createService = (host: string): OnboardingService =>
    createOnboardingService({ trpc: opts.buildTrpc(host) });
  const parent = new Command("onboarding").description(
    "Record what the person's onboarding reached",
  );
  parent.addCommand(
    buildFirstResultCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createOnboardingService: createService,
    }),
  );
  return { commands: [parent] };
}
