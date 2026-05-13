import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import { createTrpcClient } from "../shared/trpc/trpc-client.js";
import { buildListCommand } from "./commands/list.js";
import {
  createTemplatesService,
  type TemplatesService,
} from "./services/templates-service.js";

export interface TemplatesModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  serverEnvVar: string;
}

export interface TemplatesModule {
  commands: ReadonlyArray<Command>;
  exports: {
    createService: (host: string) => TemplatesService;
  };
}

export function composeTemplatesModule(opts: TemplatesModuleOptions): TemplatesModule {
  const createService = (host: string): TemplatesService => {
    const trpc = createTrpcClient({
      host,
      getToken: async () => {
        const result = await opts.tokenProvider.getValidAccessToken(host);
        if (result.ok) return result;
        const classified = classifyTokenProviderError(result.error);
        if (classified.kind === "auth-required") {
          return { ok: false, error: classified };
        }
        throw new Error(classified.reason);
      },
    });
    return createTemplatesService({ trpc });
  };

  const parent = new Command("templates").description(
    "Discover agent templates on the active host",
  );
  parent.addCommand(
    buildListCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createTemplatesService: createService,
      serverEnvVar: opts.serverEnvVar,
    }),
    { isDefault: true },
  );

  return {
    commands: [parent],
    exports: { createService },
  };
}

interface ReasonBearing {
  reason?: string;
  host?: string;
  kind: string;
}

type ClassifiedError =
  | { kind: "auth-required"; reason: string }
  | { kind: "non-auth"; reason: string };

function classifyTokenProviderError(e: unknown): ClassifiedError {
  if (typeof e !== "object" || e === null) {
    return { kind: "non-auth", reason: "auth failure" };
  }
  const re = e as ReasonBearing;
  switch (re.kind) {
    case "not-logged-in":
      return { kind: "auth-required", reason: re.host ? `not logged in to ${re.host}` : "not logged in" };
    case "session-expired":
      return { kind: "auth-required", reason: re.host ? `session expired for ${re.host}` : "session expired" };
    default:
      return { kind: "non-auth", reason: re.reason ?? re.kind };
  }
}
