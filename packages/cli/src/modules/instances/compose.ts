import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import { buildGetCommand } from "./commands/get.js";
import { buildListCommand } from "./commands/list.js";
import { createInstancesTrpcClient } from "./infrastructure/trpc-client.js";
import {
  createInstancesService,
  type InstancesService,
} from "./services/instances-service.js";

/**
 * Composition options for the `instances` module.
 *
 * The `host` (Active Host URL) is **not** taken at module-compose time:
 * the program's `compose()` runs before commander parses flags, so the
 * `--server` override is only known once a command's action fires. The
 * module instead exposes a factory `createService(host)` that issue 3's
 * commands call after resolving the host via `configService.getResolved`
 * with the same precedence the auth verbs use (`--server` → env →
 * `config.toml`). `tokenProvider`, `configService`, `compatService` are
 * injected by the package-level compose and held by closure.
 */
export interface InstancesModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  /** Env var name for the server URL — surfaced in the
   *  `no server configured` hints in command actions. */
  serverEnvVar: string;
}

export interface InstancesModule {
  commands: ReadonlyArray<Command>;
  exports: {
    /** Build an `InstancesService` bound to the resolved Active Host.
     *  Exposed so future verbs (`dam shell`, #86) can reuse it without
     *  re-implementing the bearer-supplier wiring. */
    createService: (host: string) => InstancesService;
  };
}

export function composeInstancesModule(opts: InstancesModuleOptions): InstancesModule {
  const createService = (host: string): InstancesService => {
    const trpc = createInstancesTrpcClient({
      host,
      getToken: async () => {
        const result = await opts.tokenProvider.getValidAccessToken(host);
        if (result.ok) return result;
        return {
          ok: false,
          error: { kind: "auth-required", reason: tokenProviderReason(result.error) },
        };
      },
    });
    return createInstancesService({ trpc });
  };

  // `dam instances` — parent group. Bare `dam instances` aliases to
  // `list` via commander's `isDefault: true` on the subcommand.
  const parent = new Command("instances").description(
    "Address Instances by name or ID",
  );
  parent.addCommand(
    buildListCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createInstancesService: createService,
      serverEnvVar: opts.serverEnvVar,
    }),
    { isDefault: true },
  );
  parent.addCommand(
    buildGetCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createInstancesService: createService,
      serverEnvVar: opts.serverEnvVar,
    }),
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

/** Best-effort flattening of any `TokenProviderError` variant to a
 *  human-readable reason. Avoids importing the auth domain's
 *  discriminant directly. */
function tokenProviderReason(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const re = e as ReasonBearing;
    if (re.reason) return re.reason;
    if (re.kind === "not-logged-in" && re.host) return `not logged in to ${re.host}`;
    if (re.kind === "session-expired" && re.host) return `session expired for ${re.host}`;
    return re.kind;
  }
  return "auth failure";
}
