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
        const classified = classifyTokenProviderError(result.error);
        if (classified.kind === "auth-required") {
          return { ok: false, error: classified };
        }
        // Non-auth failure — surface as a thrown error so the service
        // layer classifies it as `transport`. Login won't fix these:
        // refresh failures and auth-store I/O errors need different
        // remediation, not `dam auth login`.
        throw new Error(classified.reason);
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

type ClassifiedError =
  | { kind: "auth-required"; reason: string }
  | { kind: "non-auth"; reason: string };

/** Classify a `TokenProviderError` into two buckets without importing the
 *  auth domain's discriminant.
 *
 *  Only `not-logged-in` and `session-expired` route to `auth-required` —
 *  those are the cases where `dam auth login` is the fix. Everything else
 *  (refresh failures, auth-store I/O errors, malformed auth store) is a
 *  non-auth condition that login can't repair; the service layer surfaces
 *  those as `transport` errors carrying the original reason. */
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
